import { readFileSync } from 'fs';
import { join } from 'path';
import type { Request, Response } from 'express';
import type {
  CreateManualSubscriptionIssuePayload,
  CreateMigrationTaskPayload,
  SubscriptionDraftType,
  SubscriptionIssueType,
  SubscriptionPublishPayload,
  SubscriptionPushPayload,
  SubscriptionStateEntryType,
} from '@reports/shared';
import { formatLeakFindings, scanForLeaks } from '@pipe/protocol';

import { getProjectDict } from '../reports/project-dict-props';
import { statusDict } from '../reports/constants';
import { getSubscriptionConfig, findMigration, findTrackedProject } from './config-props';
import { requireTrackedProject, workTreeFor } from './work-tree';
import { getAllIssueStates, getIssueState, setIssueState, removeIssueState, issueKey } from './state-props';
import { parseAttachments } from './attachments';
import { collectMigrationFiles, countMigrationFiles, migrationTitle, requireMigration, TARGET_PREFIX, SOURCE_PREFIX } from './migration';
import { listAssignedOpenIssues, getCurrentUsername, getIssue, addIssueNote, getIssueTimeStats, setIssueTimeEstimate, getIssueImages, getIssueNotes } from './gitlab-client';
import { openPullRequestForTask } from './pull-request';
import { listIssues as listGithubIssues, getIssue as getGithubIssue, addComment as addGithubComment, getLogin as getGithubLogin } from './github-client';
import { buildBranchName, createBranch } from './git';
import { withStream } from '../utils/stream';
import { walkProjectFiles } from './walk';
import { applyDictionary } from './dictionary';
import { buildArchive } from './pack';
import { uploadParcel, createWorkerJob } from './bridge-client';
import { encryptBuffer } from './encryption';
import { pullSubscriptionIssue } from './pull';
import { resetSubscriptionIssue } from './reset';

export { pullSubscriptionIssue };

const PROJECT_ID_PATTERN = /^[\w.\-/%]+$/;
// Numeric GitLab/GitHub iid, or a manual entry's `m-` id (see createManualSubscriptionIssue).
const IID_PATTERN = /^(\d+|m-[\w-]+)$/;

// Route params are URL-decoded by Express and end up in GitLab URLs and state
// keys — reject anything path-like before any outbound or state call.
function rejectBadIssueParams(req: Request<Record<string, string>>, res: Response): boolean {
  const { projectId, iid } = req.params;

  if (!PROJECT_ID_PATTERN.test(projectId ?? '') || !IID_PATTERN.test(iid ?? '')) {
    res.status(400).json({ error: 'Invalid projectId or iid' });
    return true;
  }

  return false;
}

function parcelName(projectId: string, iid: string, encrypted: boolean): string {
  return `${projectId}-${iid}.subscription.zip${encrypted ? '.enc' : ''}`;
}

// GitHub-backed tracked project (see TrackedProjectType.provider) — its
// issues come from the GitHub API instead of GitLab, everything after that
// (init → draft → push → pull → publish) is the same local pipeline.
function githubProjectFor(projectId: string | number) {
  const project = findTrackedProject(projectId);

  return project?.provider === 'github' && project.githubRepo ? { ...project, githubRepo: project.githubRepo } : undefined;
}

async function branchUsername(projectId: string | number): Promise<string> {
  return githubProjectFor(projectId) ? getGithubLogin() : getCurrentUsername();
}

export async function handleListSubscriptionIssues(req: Request<Record<string, string>>, res: Response) {
  await withStream(res, 'List subscription issues', async () => {
    const issues = await listAssignedOpenIssues();
    const projectDict = getProjectDict();
    const config = getSubscriptionConfig();
    const states = getAllIssueStates();

    const result: SubscriptionIssueType[] = issues.map((issue) => ({
      id: issue.id,
      iid: issue.iid,
      projectId: issue.project_id,
      projectName: projectDict[issue.project_id] || String(issue.project_id),
      title: issue.title,
      description: issue.description ?? '',
      webUrl: issue.web_url ?? '',
      timeEstimate: issue.time_stats?.human_time_estimate ?? '',
      state: issue.state,
      status: statusDict[issue.state] ?? issue.state,
      tracked: config.trackedProjects.some((project) => project.gitlabProjectId === String(issue.project_id)),
      subscription: states[issueKey(issue.project_id, issue.iid)],
    }));

    for (const project of config.trackedProjects) {
      const github = githubProjectFor(project.gitlabProjectId);

      if (!github) continue;

      for (const issue of await listGithubIssues(github.githubRepo, github.githubLabel)) {
        result.push({
          id: String(issue.id),
          iid: String(issue.number),
          projectId: Number(github.gitlabProjectId),
          projectName: github.githubRepo,
          title: issue.title,
          description: issue.body ?? '',
          webUrl: issue.html_url,
          timeEstimate: '',
          state: 'opened',
          status: statusDict.opened ?? 'opened',
          tracked: true,
          source: 'github',
          subscription: states[issueKey(github.gitlabProjectId, issue.number)],
        });
      }
    }

    // Manual parcels have no GitLab issue behind them, so they never appear
    // in `issues` above — synthesize a row for each from its own stored
    // state instead of a GitLab fetch.
    for (const [key, state] of Object.entries(states)) {
      if (!state.manual) continue;

      const [manualProjectId, manualIid] = key.split(':');

      result.push({
        id: manualIid,
        iid: manualIid,
        projectId: state.projectId ?? Number(manualProjectId),
        projectName: findMigration(manualProjectId)?.name || githubProjectFor(manualProjectId)?.githubRepo || projectDict[manualProjectId] || manualProjectId,
        title: state.title ?? '',
        description: state.description ?? '',
        webUrl: '',
        timeEstimate: '',
        state: 'manual',
        status: state.kind === 'migration' ? 'Миграция' : 'Вручную',
        tracked: state.kind === 'migration' ? Boolean(findMigration(manualProjectId)) : config.trackedProjects.some((project) => project.gitlabProjectId === manualProjectId),
        ...(state.kind === 'migration' ? { kind: 'migration' as const } : {}),
        subscription: state,
      });
    }

    return result;
  });
}

export async function handleInitSubscriptionIssue(req: Request<Record<string, string>>, res: Response) {
  if (rejectBadIssueParams(req, res)) return;

  const { projectId, iid } = req.params;

  await withStream(res, 'Init subscription issue', async () => {
    const workTree = workTreeFor(projectId);
    const username = await branchUsername(projectId);
    const branch = buildBranchName(username, iid);

    await createBranch(workTree.path, branch, workTree.baseBranch);

    return setIssueState(projectId, iid, { step: 'init', branch });
  });
}

// No real GitLab issue behind this — same local pipeline (init → draft →
// push → pull → publish) as a real one, just seeded from typed text instead
// of a GitLab fetch. The `m-` prefix can't collide with a real iid, which is
// always numeric.
export async function createManualSubscriptionIssue(
  gitlabProjectId: string,
  title: string,
  description: string,
): Promise<{ iid: string; state: SubscriptionStateEntryType }> {
  const trackedProject = requireTrackedProject(gitlabProjectId);
  const iid = `m-${Date.now().toString(36)}`;
  // Unlike a real init, this shouldn't hard-require GitLab credentials
  // just to prefix a branch name — falls back the same way git.ts's own
  // sanitizeUsername does.
  const username = await branchUsername(gitlabProjectId).catch(() => 'user');
  const branch = buildBranchName(username, iid);

  await createBranch(trackedProject.path, branch, trackedProject.baseBranch || 'main');

  const state = setIssueState(gitlabProjectId, iid, {
    step: 'init',
    branch,
    manual: true,
    title,
    description,
    projectId: Number(gitlabProjectId),
  });

  return { iid, state };
}

// A migration task: like a manual one — text instead of a GitLab issue, the same init → push → worker → pull pipeline — but the branch is
// made in the TARGET repository of the migration, and the text says which module has to be brought up to date or added there.
export async function createMigrationTask(
  migrationId: string,
  description: string,
  title?: string,
): Promise<{ iid: string; state: SubscriptionStateEntryType }> {
  const migration = requireMigration(migrationId);
  const text = (description ?? '').trim();

  if (!text) {
    throw new Error('Опишите задачу: какой модуль нужно актуализировать или добавить в целевом репозитории');
  }

  const iid = `m-${Date.now().toString(36)}`;
  const username = await branchUsername(migrationId).catch(() => 'user');
  const branch = buildBranchName(username, iid);

  await createBranch(migration.targetPath, branch, migration.targetBaseBranch || 'main');

  const state = setIssueState(migrationId, iid, {
    step: 'init',
    branch,
    manual: true,
    kind: 'migration',
    title: migrationTitle(text, title),
    description: text,
    projectId: Number(migrationId),
  });

  return { iid, state };
}

export async function handleCreateMigrationTask(req: Request<Record<string, string>>, res: Response) {
  const { migrationId, description, title } = req.body as CreateMigrationTaskPayload;

  await withStream(res, 'Create migration task', async () => (await createMigrationTask(migrationId, description, title)).state);
}

export async function handleCreateManualSubscriptionIssue(req: Request<Record<string, string>>, res: Response) {
  const { gitlabProjectId, title, description } = req.body as CreateManualSubscriptionIssuePayload;

  await withStream(res, 'Create manual subscription issue', async () => (await createManualSubscriptionIssue(gitlabProjectId, title, description)).state);
}

// For a GitLab-backed issue this only resets local progress — the issue
// itself stays listed (handleListSubscriptionIssues sources that from
// GitLab). For a manual one, state is its only record anywhere, so this is
// the only way it can be removed.
export async function handleRemoveSubscriptionIssue(req: Request<Record<string, string>>, res: Response) {
  if (rejectBadIssueParams(req, res)) return;

  const { projectId, iid } = req.params;

  await withStream(res, 'Remove subscription issue', async () => {
    removeIssueState(projectId, iid);
    return { removed: true };
  });
}

// Anonymized preview of what push would send, without sending it — the
// client shows/edits this, then push (below) takes the reviewed text back
// verbatim instead of re-fetching/re-anonymizing the issue itself, so what
// was actually reviewed is what actually gets sent.
export async function handleGetSubscriptionDraft(req: Request<Record<string, string>>, res: Response) {
  if (rejectBadIssueParams(req, res)) return;

  const { projectId, iid } = req.params;

  await withStream(res, 'Get subscription draft', async () => {
    const { dictionary } = getSubscriptionConfig();
    const state = getIssueState(projectId, iid);

    const [rawTitle, rawDescription, issueId, draftProjectId] = state?.manual
      ? [state.title ?? '', state.description ?? '', iid, state.projectId ?? Number(projectId)]
      : githubProjectFor(projectId)
        ? await getGithubIssue(githubProjectFor(projectId)!.githubRepo, iid).then((issue) => [issue.title, issue.body ?? '', issue.id, Number(projectId)])
        : await getIssue(projectId, iid).then((issue) => [issue.title, issue.description ?? '', issue.id, issue.project_id]);

    const title = applyDictionary(String(rawTitle), dictionary, 'toRemote');
    const description = applyDictionary(String(rawDescription), dictionary, 'toRemote');
    // For a migration task the review also says what the parcel will carry from each of the two repositories.
    const migration = state?.kind === 'migration' ? requireMigration(projectId) : undefined;
    const counts = migration ? await countMigrationFiles(migration) : undefined;

    const draft: SubscriptionDraftType = {
      issueId: String(issueId),
      projectId: Number(draftProjectId),
      title,
      description,
      leaks: scanForLeaks([
        { source: 'issue title', content: title },
        { source: 'issue description', content: description },
      ]),
      ...(migration && counts ? { migration: { name: migration.name, sourcePath: migration.sourcePath, targetPath: migration.targetPath, ...counts } } : {}),
    };

    return draft;
  });
}

export async function handlePushSubscriptionIssue(req: Request<Record<string, string>>, res: Response) {
  if (rejectBadIssueParams(req, res)) return;

  const { projectId, iid } = req.params;
  const { issueId, title: issueTitle, description: issueDescription, attachments } = req.body as SubscriptionPushPayload;

  await withStream(res, 'Push subscription issue', async () => {
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
    const isGitlabIssue = !state.manual && !githubProjectFor(projectId);
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
  });
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

export async function handlePullSubscriptionIssue(req: Request<Record<string, string>>, res: Response) {
  if (rejectBadIssueParams(req, res)) return;

  const { projectId, iid } = req.params;

  await withStream(res, 'Pull subscription issue', () => pullSubscriptionIssue(projectId, iid));
}

export async function handleResetSubscriptionIssue(req: Request<Record<string, string>>, res: Response) {
  if (rejectBadIssueParams(req, res)) return;

  const { projectId, iid } = req.params;
  const discardFiles = (req.body as { discardFiles?: unknown } | undefined)?.discardFiles === true;

  await withStream(res, 'Reset subscription issue', () => resetSubscriptionIssue(projectId, iid, { discardFiles }));
}

export async function handlePublishSubscriptionIssue(req: Request<Record<string, string>>, res: Response) {
  if (rejectBadIssueParams(req, res)) return;

  const { projectId, iid } = req.params;
  const { templateId, comment, timeEstimate } = req.body as SubscriptionPublishPayload;

  await withStream(res, 'Publish subscription issue', async () => {
    const state = getIssueState(projectId, iid);
    const { commentTemplates } = getSubscriptionConfig();
    const template = templateId ? commentTemplates.find((item) => item.id === templateId) : undefined;
    const body = (template?.body ?? comment ?? '').replace(/{{\s*branch\s*}}/g, state?.branch ?? '');

    // A manual entry has no issue to comment on or estimate — publish
    // still just marks local pipeline state, for bookkeeping symmetry.
    const github = githubProjectFor(projectId);

    // GitHub task: make sure the PR exists (the autopilot normally opened it
    // at pull time — this covers a manual Pull, or one that failed). A no-op
    // when it is already open; never merges.
    if (github && !state?.manual) {
      await openPullRequestForTask(projectId, iid);
    }

    if (!state?.manual) {
      if (body.trim()) {
        await (github ? addGithubComment(github.githubRepo, iid, body) : addIssueNote(projectId, iid, body));
      }

      // GitHub has no time-estimate concept.
      if (!github && timeEstimate?.trim()) {
        await setIssueTimeEstimate(projectId, iid, timeEstimate.trim());
      }
    }

    return setIssueState(projectId, iid, { step: 'published', publishedAt: new Date().toISOString() });
  });
}

export async function handleGetSubscriptionIssueTime(req: Request<Record<string, string>>, res: Response) {
  if (rejectBadIssueParams(req, res)) return;

  const { projectId, iid } = req.params;

  await withStream(res, 'Get subscription issue time', async () => {
    const state = getIssueState(projectId, iid);

    return state?.manual || githubProjectFor(projectId) ? { humanTimeEstimate: null } : getIssueTimeStats(projectId, iid);
  });
}
