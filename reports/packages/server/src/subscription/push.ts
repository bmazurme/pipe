import { readFileSync } from 'fs';
import { join } from 'path';
import type { SubscriptionPushPayload, SubscriptionStateEntryType } from '@reports/shared';
import { formatLeakFindings, scanForLeaks } from '@pipe/protocol';

import { getSubscriptionConfig, findTrackedProject } from './config-props';
import { requireTrackedProject } from './work-tree';
import { getIssueState, setIssueState } from './state-props';
import { parseAttachments } from './attachments';
import { collectMigrationFiles, requireMigration, TARGET_PREFIX, SOURCE_PREFIX } from './migration';
import { getIssue, getIssueImages, getIssueNotes } from './gitlab-client';
import { walkProjectFiles } from './walk';
import { applyDictionary } from './dictionary';
import { buildArchive } from './pack';
import { uploadParcel, createWorkerJob } from './bridge-client';
import { encryptBuffer } from './encryption';

function parcelName(projectId: string, iid: string, encrypted: boolean): string {
  return `${projectId}-${iid}.subscription.zip${encrypted ? '.enc' : ''}`;
}

// GitHub-backed tracked project (see TrackedProjectType.provider).
function isGithubProject(projectId: string | number): boolean {
  const project = findTrackedProject(projectId);

  return project?.provider === 'github' && Boolean(project.githubRepo);
}

// Pushes one task's parcel to bridge: the tracked tree (or both migration
// repositories), anonymized, leak-scanned, archived, optionally encrypted.
// The domain half of the Push button, like pullSubscriptionIssue for Pull.
export async function pushSubscriptionIssue(
  projectId: string,
  iid: string,
  payload: SubscriptionPushPayload,
): Promise<SubscriptionStateEntryType> {
  const { issueId, title: issueTitle, description: issueDescription, attachments } = payload;

  const state = getIssueState(projectId, iid);
  // A migration task sends BOTH repositories — the current one under source/, the target under target/ — not a tracked project's tree.
  const migration = state?.kind === 'migration' ? requireMigration(projectId) : undefined;
  const trackedProject = migration ? undefined : requireTrackedProject(projectId);

  if (!state?.branch) {
    throw new Error('Сначала выполните init — ветка ещё не создана');
  }

  const { dictionary, encryption } = getSubscriptionConfig();
  let files: { relPath: string; content: string }[];

  if (migration) {
    files = (await collectMigrationFiles(migration, dictionary)).files;
  } else {
    const tracked = trackedProject!;
    const relPaths = await walkProjectFiles(tracked);
    // Same stop as sync's push-issue: a parcel with no project files would reach a worker as an empty working directory.
    if (relPaths.length === 0) {
      throw new Error(
        `В отслеживаемом проекте ${tracked.path} нет файлов, подходящих под include/exclude, — посылка была бы пустой. ` +
          'Проверьте путь и шаблоны include/exclude проекта в Settings.',
      );
    }
    files = relPaths.map((relPath) => ({
      relPath,
      content: applyDictionary(readFileSync(join(tracked.path, relPath), 'utf-8'), dictionary, 'toRemote'),
    }));
  }

  // Image refs only resolve against the *real* GitLab markdown — the
  // dictionary-substituted description above isn't safe to scan for them
  // (a substitution could alter an /uploads/... path), so this still
  // needs its own live fetch for a real issue. A manual parcel has no
  // GitLab-hosted markdown to scan at all.
  // (GitHub issues: no image fetch either — their attachments sit behind
  // a different, signed-URL mechanism this doesn't handle.)
  //
  // The issue's comments travel with it, images included: a screenshot or a clarification in a comment is often the
  // part of the task that matters. Their text is anonymized like the description; the images come from the real text.
  const isGitlabIssue = !state.manual && !isGithubProject(projectId);
  const gitlabIssue = isGitlabIssue ? await getIssue(projectId, iid) : null;
  const notes = isGitlabIssue ? await getIssueNotes(projectId, iid) : [];
  const issueComments = notes.map((note) => ({
    author: applyDictionary(note.author?.name || note.author?.username || '', dictionary, 'toRemote'),
    createdAt: note.created_at,
    body: applyDictionary(note.body, dictionary, 'toRemote'),
  }));
  const issueImages = isGitlabIssue
    ? await getIssueImages([gitlabIssue?.description ?? '', ...notes.map((note) => note.body)].join('\n\n'), projectId)
    : [];
  // Screenshots attached by hand, for any task (a manual one has no issue to take them from).
  const attached = parseAttachments(attachments, issueImages.map((image) => image.relPath.replace(/^issue-images\//, '')));
  const images = [...issueImages, ...attached];

  // Images never go through scanForLeaks (text-only) — this is the only
  // signal the operator gets that they weren't checked, strict or not.
  if (images.length > 0) {
    console.warn(`[subscription ${projectId}:${iid}] ${images.length} image(s) were not leak-scanned.`);
  }

  const leaks = scanForLeaks([
    ...files.map((f) => ({ source: f.relPath, content: f.content })),
    { source: 'issue title', content: issueTitle },
    { source: 'issue description', content: issueDescription },
    ...issueComments.map((comment, index) => ({ source: `issue comment ${index + 1}`, content: comment.body })),
  ]);
  if (leaks.length > 0) {
    console.warn(`[subscription ${projectId}:${iid}] ${formatLeakFindings(leaks)}`);

    if (getSubscriptionConfig().leakScanStrict) {
      throw new Error(
        `leakScanStrict: ${leaks.length} possible leak(s) found — push aborted. ` +
          'Disable "Строгая проверка на утечки" in Settings to push anyway.',
      );
    }
  }

  const archive = buildArchive(
    files,
    {
      issueId,
      issueIid: iid,
      issueTitle,
      issueDescription,
      ...(issueComments.length > 0 ? { issueComments } : {}),
      ...(migration ? { migration: { name: migration.name, sourceRoot: SOURCE_PREFIX, targetRoot: TARGET_PREFIX } } : {}),
      projectId: Number(projectId),
      branch: state.branch,
      createdAt: new Date().toISOString(),
    },
    images,
  );

  const shouldEncrypt = encryption.enabled && !!encryption.publicKey;

  if (encryption.enabled && !encryption.publicKey) {
    throw new Error('Шифрование включено, но публичный ключ не задан — сгенерируйте пару ключей в Settings');
  }

  const buffer = shouldEncrypt ? encryptBuffer(archive, encryption.publicKey) : archive;
  const stored = await uploadParcel(buffer, parcelName(projectId, iid, shouldEncrypt), {
    channel: 'issue',
    taskKey: `${projectId}:${iid}`,
    direction: 'outbound',
  });

  const pushed = setIssueState(projectId, iid, {
    step: 'pushed',
    parcelId: stored.id,
    pushedAt: new Date().toISOString(),
    encrypted: shouldEncrypt,
  });

  await startWorkerIfConfigured(projectId, iid, stored.id, shouldEncrypt);

  return pushed;
}

// Optional automatic hand-off to the worker (config.autoStartWorkerModel). The
// push itself is already recorded and valid, so a failure here must not look like
// a failed push — but it must not be silent either (a task that never starts is
// exactly the manual step this exists to remove): it is rethrown with a message
// that says the parcel did go out.
async function startWorkerIfConfigured(projectId: string, iid: string, parcelId: number, encrypted: boolean): Promise<void> {
  const { autoStartWorkerModel } = getSubscriptionConfig();

  if (!autoStartWorkerModel) return;

  if (encrypted) {
    console.warn(`[subscription ${projectId}:${iid}] auto-start skipped: worker only accepts unencrypted parcels.`);
    return;
  }

  try {
    const job = await createWorkerJob(parcelId, autoStartWorkerModel);

    console.log(`[subscription ${projectId}:${iid}] worker job ${job.id} started (${autoStartWorkerModel}).`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    throw new Error(`Посылка отправлена, но задачу на worker запустить не удалось: ${reason}`);
  }
}
