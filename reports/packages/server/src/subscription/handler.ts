import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import type { Request, Response } from 'express';
import type { StreamEvent, SubscriptionIssueType, SubscriptionPublishPayload } from '@reports/shared';

import { getSettings } from '../settings/props';
import { getProjectDict } from '../reports/project-dict-props';
import { statusDict } from '../reports/constants';
import { getSubscriptionConfig, findTrackedProject } from './config-props';
import { getAllIssueStates, getIssueState, setIssueState, issueKey } from './state-props';
import { listAssignedOpenIssues, getCurrentUsername, getIssue, addIssueNote, getIssueTimeStats, setIssueTimeEstimate } from './gitlab-client';
import { buildBranchName, createBranch } from './git';
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

export async function handlePushSubscriptionIssue(req: Request, res: Response) {
  const { projectId, iid } = req.params;

  await withStream(res, 'Push subscription issue', async () => {
    const trackedProject = requireTrackedProject(projectId);
    const state = getIssueState(projectId, iid);

    if (!state?.branch) {
      throw new Error('Сначала выполните init — ветка ещё не создана');
    }

    const { dictionary, encryption } = getSubscriptionConfig();
    const issue = await getIssue(projectId, iid);
    const relPaths = await walkProjectFiles(trackedProject);
    const files = relPaths.map((relPath) => ({
      relPath,
      content: applyDictionary(readFileSync(join(trackedProject.path, relPath), 'utf-8'), dictionary, 'toRemote'),
    }));

    const archive = buildArchive(files, {
      issueId: issue.id,
      issueIid: issue.iid,
      issueTitle: applyDictionary(issue.title, dictionary, 'toRemote'),
      issueDescription: applyDictionary(issue.description ?? '', dictionary, 'toRemote'),
      projectId: issue.project_id,
      branch: state.branch,
      createdAt: new Date().toISOString(),
    });

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
    const { files } = extractArchive(buffer);
    const projectRoot = resolve(trackedProject.path);

    for (const file of files) {
      const destination = resolve(projectRoot, file.relPath);

      if (destination !== projectRoot && relative(projectRoot, destination).startsWith('..')) {
        throw new Error(`Посылка содержит путь вне репозитория: ${file.relPath}`);
      }

      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, applyDictionary(file.content, dictionary, 'toLocal'), 'utf-8');
    }

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

    if (body.trim()) {
      await addIssueNote(projectId, iid, body);
    }

    if (timeEstimate?.trim()) {
      await setIssueTimeEstimate(projectId, iid, timeEstimate.trim());
    }

    return setIssueState(projectId, iid, { step: 'published', publishedAt: new Date().toISOString() });
  });
}

export async function handleGetSubscriptionIssueTime(req: Request, res: Response) {
  const { projectId, iid } = req.params;

  await withStream(res, 'Get subscription issue time', () => getIssueTimeStats(projectId, iid));
}
