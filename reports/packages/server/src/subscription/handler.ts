import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import type { Request, Response } from 'express';
import type {
  CreateManualSubscriptionIssuePayload,
  StreamEvent,
  SubscriptionDraftType,
  SubscriptionIssueType,
  SubscriptionPublishPayload,
  SubscriptionPushPayload,
} from '@reports/shared';
import { formatLeakFindings, scanForLeaks } from '@pipe/protocol';

import { getSettings } from '../settings/props';
import { getProjectDict } from '../reports/project-dict-props';
import { statusDict } from '../reports/constants';
import { getSubscriptionConfig, findTrackedProject } from './config-props';
import { getAllIssueStates, getIssueState, setIssueState, removeIssueState, issueKey } from './state-props';
import { listAssignedOpenIssues, getCurrentUsername, getIssue, addIssueNote, getIssueTimeStats, setIssueTimeEstimate, getIssueImages } from './gitlab-client';
import { buildBranchName, createBranch, checkoutTaskBranch, commitPulledFiles, pushBranch } from './git';
import { walkProjectFiles } from './walk';
import { applyDictionary } from './dictionary';
import { buildArchive, extractArchive } from './pack';
import { uploadParcel, listParcels, downloadParcel } from './bridge-client';
import { encryptBuffer, decryptBuffer } from './encryption';

function sender(res: Response) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  return (event: StreamEvent) => {
    res.write(JSON.stringify(event) + '\n');
  };
}

async function withStream(res: Response, label: string, run: () => Promise<unknown>) {
  const sendEvent = sender(res);

  try {
    sendEvent({ type: 'message', data: await run() });
  } catch (error) {
    console.error(`${label} error:`, error);
    sendEvent({ type: 'error', data: error instanceof Error ? error.message : 'Unknown error' });
  } finally {
    res.end();
  }
}

function parcelName(projectId: string, iid: string, encrypted: boolean): string {
  return `${projectId}-${iid}.subscription.zip${encrypted ? '.enc' : ''}`;
}

function requireTrackedProject(projectId: string) {
  const trackedProject = findTrackedProject(projectId);

  if (!trackedProject) {
    throw new Error('Этот проект не отслеживается: добавьте локальный репозиторий в Settings → Отслеживаемые репозитории');
  }

  return trackedProject;
}

export async function handleListSubscriptionIssues(req: Request, res: Response) {
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
        projectName: projectDict[manualProjectId] || manualProjectId,
        title: state.title ?? '',
        description: state.description ?? '',
        webUrl: '',
        timeEstimate: '',
        state: 'manual',
        status: 'Вручную',
        tracked: config.trackedProjects.some((project) => project.gitlabProjectId === manualProjectId),
        subscription: state,
      });
    }

    return result;
  });
}

export async function handleInitSubscriptionIssue(req: Request, res: Response) {
  const { projectId, iid } = req.params;

  await withStream(res, 'Init subscription issue', async () => {
    const trackedProject = requireTrackedProject(projectId);
    const username = await getCurrentUsername();
    const branch = buildBranchName(username, iid);

    await createBranch(trackedProject.path, branch, trackedProject.baseBranch || 'main');

    return setIssueState(projectId, iid, { step: 'init', branch });
  });
}

// No real GitLab issue behind this — same local pipeline (init → draft →
// push → pull → publish) as a real one, just seeded from typed text instead
// of a GitLab fetch. The `m-` prefix can't collide with a real iid, which is
// always numeric.
export async function handleCreateManualSubscriptionIssue(req: Request, res: Response) {
  const { gitlabProjectId, title, description } = req.body as CreateManualSubscriptionIssuePayload;

  await withStream(res, 'Create manual subscription issue', async () => {
    const trackedProject = requireTrackedProject(gitlabProjectId);
    const iid = `m-${Date.now().toString(36)}`;
    // Unlike a real init, this shouldn't hard-require GitLab credentials
    // just to prefix a branch name — falls back the same way git.ts's own
    // sanitizeUsername does.
    const username = await getCurrentUsername().catch(() => 'user');
    const branch = buildBranchName(username, iid);

    await createBranch(trackedProject.path, branch, trackedProject.baseBranch || 'main');

    return setIssueState(gitlabProjectId, iid, {
      step: 'init',
      branch,
      manual: true,
      title,
      description,
      projectId: Number(gitlabProjectId),
    });
  });
}

// For a GitLab-backed issue this only resets local progress — the issue
// itself stays listed (handleListSubscriptionIssues sources that from
// GitLab). For a manual one, state is its only record anywhere, so this is
// the only way it can be removed.
export async function handleRemoveSubscriptionIssue(req: Request, res: Response) {
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
export async function handleGetSubscriptionDraft(req: Request, res: Response) {
  const { projectId, iid } = req.params;

  await withStream(res, 'Get subscription draft', async () => {
    const { dictionary } = getSubscriptionConfig();
    const state = getIssueState(projectId, iid);

    const [rawTitle, rawDescription, issueId, draftProjectId] = state?.manual
      ? [state.title ?? '', state.description ?? '', iid, state.projectId ?? Number(projectId)]
      : await getIssue(projectId, iid).then((issue) => [issue.title, issue.description ?? '', issue.id, issue.project_id]);

    const title = applyDictionary(String(rawTitle), dictionary, 'toRemote');
    const description = applyDictionary(String(rawDescription), dictionary, 'toRemote');

    const draft: SubscriptionDraftType = {
      issueId: String(issueId),
      projectId: Number(draftProjectId),
      title,
      description,
      leaks: scanForLeaks([
        { source: 'issue title', content: title },
        { source: 'issue description', content: description },
      ]),
    };

    return draft;
  });
}

export async function handlePushSubscriptionIssue(req: Request, res: Response) {
  const { projectId, iid } = req.params;
  const { issueId, title: issueTitle, description: issueDescription } = req.body as SubscriptionPushPayload;

  await withStream(res, 'Push subscription issue', async () => {
    const trackedProject = requireTrackedProject(projectId);
    const state = getIssueState(projectId, iid);

    if (!state?.branch) {
      throw new Error('Сначала выполните init — ветка ещё не создана');
    }

    const { dictionary, encryption } = getSubscriptionConfig();
    const relPaths = await walkProjectFiles(trackedProject);
    const files = relPaths.map((relPath) => ({
      relPath,
      content: applyDictionary(readFileSync(join(trackedProject.path, relPath), 'utf-8'), dictionary, 'toRemote'),
    }));

    // Image refs only resolve against the *real* GitLab markdown — the
    // dictionary-substituted description above isn't safe to scan for them
    // (a substitution could alter an /uploads/... path), so this still
    // needs its own live fetch for a real issue. A manual parcel has no
    // GitLab-hosted markdown to scan at all.
    const images = state.manual ? [] : await getIssueImages((await getIssue(projectId, iid)).description ?? '');

    const leaks = scanForLeaks([
      ...files.map((f) => ({ source: f.relPath, content: f.content })),
      { source: 'issue title', content: issueTitle },
      { source: 'issue description', content: issueDescription },
    ]);
    if (leaks.length > 0) {
      console.warn(`[subscription ${projectId}:${iid}] ${formatLeakFindings(leaks)}`);
    }

    const archive = buildArchive(
      files,
      {
        issueId,
        issueIid: iid,
        issueTitle,
        issueDescription,
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
    const stored = await uploadParcel(buffer, parcelName(projectId, iid, shouldEncrypt));

    return setIssueState(projectId, iid, {
      step: 'pushed',
      parcelId: stored.id,
      pushedAt: new Date().toISOString(),
      encrypted: shouldEncrypt,
    });
  });
}

export async function handlePullSubscriptionIssue(req: Request, res: Response) {
  const { projectId, iid } = req.params;

  await withStream(res, 'Pull subscription issue', async () => {
    const trackedProject = requireTrackedProject(projectId);
    const plainName = parcelName(projectId, iid, false);
    const encryptedName = parcelName(projectId, iid, true);
    const parcels = (await listParcels())
      .filter((parcel) => parcel.originalName === plainName || parcel.originalName === encryptedName)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const newest = parcels[0];

    if (!newest) {
      throw new Error('На bridge нет посылки для этой задачи — сначала выполните push из другого окружения');
    }

    const isEncrypted = newest.originalName === encryptedName;
    const { dictionary, encryption } = getSubscriptionConfig();

    if (isEncrypted && !encryption.privateKey) {
      throw new Error('Посылка зашифрована, но приватный ключ не задан — вставьте его в Settings → Шифрование');
    }

    const downloaded = await downloadParcel(newest.id);
    const buffer = isEncrypted ? decryptBuffer(downloaded, encryption.privateKey) : downloaded;
    const { manifest, files, assets } = extractArchive(buffer);
    const projectRoot = resolve(trackedProject.path);

    const state = getIssueState(projectId, iid);
    if (!state?.branch) {
      throw new Error('Сначала выполните init — ветка ещё не создана');
    }

    // Guarantees the write+commit below lands on the task branch, not
    // whatever the repo happened to be on (it can drift away from the task
    // branch between init and pull) — see checkoutTaskBranch's own comment.
    await checkoutTaskBranch(trackedProject.path, state.branch);

    for (const file of files) {
      const destination = resolve(projectRoot, file.relPath);

      if (destination !== projectRoot && relative(projectRoot, destination).startsWith('..')) {
        throw new Error(`Посылка содержит путь вне репозитория: ${file.relPath}`);
      }

      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, applyDictionary(file.content, dictionary, 'toLocal'), 'utf-8');
    }

    // Images extracted from the issue description — written next to the code
    // so a human picking up the branch can actually see what the issue showed.
    for (const asset of assets) {
      const destination = resolve(projectRoot, asset.relPath);

      if (destination !== projectRoot && relative(projectRoot, destination).startsWith('..')) {
        throw new Error(`Посылка содержит путь вне репозитория: ${asset.relPath}`);
      }

      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, Buffer.from(asset.base64, 'base64'));
    }

    // Commits and pushes the task branch only — never the target branch.
    // Getting this into the target branch is a deliberate manual step (open
    // a merge request yourself, after reviewing) — nothing here does that
    // automatically.
    const title = applyDictionary(manifest.issueTitle, dictionary, 'toLocal');
    const relPaths = [...files.map((file) => file.relPath), ...assets.map((asset) => asset.relPath)];
    await commitPulledFiles(trackedProject.path, relPaths, `Pull issue #${iid}: ${title}`);
    await pushBranch(trackedProject.path, state.branch);

    return setIssueState(projectId, iid, { step: 'pulled', pulledAt: new Date().toISOString(), encrypted: isEncrypted });
  });
}

export async function handlePublishSubscriptionIssue(req: Request, res: Response) {
  const { projectId, iid } = req.params;
  const { templateId, comment, timeEstimate } = req.body as SubscriptionPublishPayload;

  await withStream(res, 'Publish subscription issue', async () => {
    const state = getIssueState(projectId, iid);
    const { commentTemplates } = getSubscriptionConfig();
    const template = templateId ? commentTemplates.find((item) => item.id === templateId) : undefined;
    const body = (template?.body ?? comment ?? '').replace(/{{\s*branch\s*}}/g, state?.branch ?? '');

    // A manual entry has no GitLab issue to comment on or estimate — publish
    // still just marks local pipeline state, for bookkeeping symmetry.
    if (!state?.manual) {
      if (body.trim()) {
        await addIssueNote(projectId, iid, body);
      }

      if (timeEstimate?.trim()) {
        await setIssueTimeEstimate(projectId, iid, timeEstimate.trim());
      }
    }

    return setIssueState(projectId, iid, { step: 'published', publishedAt: new Date().toISOString() });
  });
}

export async function handleGetSubscriptionIssueTime(req: Request, res: Response) {
  const { projectId, iid } = req.params;

  await withStream(res, 'Get subscription issue time', () => {
    const state = getIssueState(projectId, iid);

    return state?.manual ? { humanTimeEstimate: null } : getIssueTimeStats(projectId, iid);
  });
}
