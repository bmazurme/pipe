import type { Request, Response } from 'express';
import type { AnalysisModulesType, BacklogType, CreateBacklogIssuesPayload, CreateBacklogIssuesResult, StartAnalysisPayload } from '@reports/shared';

import { ANALYSIS_KINDS, analysisTitle, buildAnalysisPrompt, BACKLOG_FILE, isAnalysisTitle, markDuplicates, normalizeModule, parseBacklog } from './analysis';
import { sendClientEvent } from './bridge-client';
import { findTrackedProject } from './config-props';
import { createIssue, DEFAULT_GITHUB_LABEL, listAllIssues } from './github-client';
import { listModules, showFile } from './git';
import { createManualSubscriptionIssue, withStream } from './handler';
import { getIssueState, setIssueState } from './state-props';
import { hostname } from 'os';

function requireGithubProject(projectId: string) {
  const project = findTrackedProject(projectId);

  if (project?.provider !== 'github' || !project.githubRepo) {
    throw new Error('Анализ доступен только для отслеживаемого GitHub-репозитория');
  }

  return { ...project, githubRepo: project.githubRepo, label: project.githubLabel || DEFAULT_GITHUB_LABEL };
}

// An analysis is an ordinary manual task whose description is the prompt —
// from here the usual init → push → worker → pull pipeline carries it. What
// is new is only the prompt (which lists everything already proposed, so the
// worker doesn't repeat it) and, after the pull, reading the result.
export async function handleStartAnalysis(req: Request<Record<string, string>>, res: Response) {
  const { projectId, kind = 'general', module: rawModule } = req.body as StartAnalysisPayload;

  await withStream(res, 'Start analysis', async () => {
    const project = requireGithubProject(projectId);

    if (!(kind in ANALYSIS_KINDS)) {
      throw new Error(`Неизвестный тип анализа: ${kind}`);
    }

    const module = normalizeModule(rawModule);
    const existing = await listAllIssues(project.githubRepo, project.label);
    const options = { kind, module };
    const { iid, state } = await createManualSubscriptionIssue(
      projectId,
      analysisTitle(new Date(), options),
      buildAnalysisPrompt(existing.map((issue) => issue.title), options),
    );

    return { iid, state };
  });
}

// Loads the backlog from the analysis task's branch with `git show` — no
// checkout, so the developer's working tree is left exactly as it is.
async function loadBacklog(projectId: string, iid: string) {
  const project = requireGithubProject(projectId);
  const state = getIssueState(projectId, iid);

  if (!state?.branch || !isAnalysisTitle(state.title)) {
    throw new Error('Это не задача анализа');
  }

  if (state.step !== 'pulled' && state.step !== 'published') {
    throw new Error('Результат анализа ещё не получен из bridge');
  }

  const raw = await showFile(project.path, state.branch, BACKLOG_FILE);

  if (raw === null) {
    throw new Error(`В ветке ${state.branch} нет файла ${BACKLOG_FILE} — worker его не создал`);
  }

  const existing = await listAllIssues(project.githubRepo, project.label);

  return { project, state, items: markDuplicates(parseBacklog(raw), existing), branch: state.branch };
}

export async function handleGetBacklog(req: Request<Record<string, string>>, res: Response) {
  const { projectId, iid } = req.params;

  await withStream(res, 'Get backlog', async () => {
    const { items, branch } = await loadBacklog(projectId, iid);

    return { items, branch } satisfies BacklogType;
  });
}

// The review step: the user ticks items, and only then do GitHub issues
// appear. The client sends indices, never content — the backlog is re-read
// from the branch here, so what gets filed is exactly what was shown, and
// nothing the browser could tamper with.
export async function handleCreateBacklogIssues(req: Request<Record<string, string>>, res: Response) {
  const { projectId, iid } = req.params;
  const { indices } = req.body as CreateBacklogIssuesPayload;

  await withStream(res, 'Create backlog issues', async () => {
    const { project, items } = await loadBacklog(projectId, iid);
    const result: CreateBacklogIssuesResult = { created: [], skipped: [] };

    for (const index of [...new Set(indices)]) {
      const item = items[index];

      if (!item) {
        result.skipped.push({ title: `#${index}`, reason: 'нет такого пункта' });
      } else if (item.duplicateOf !== undefined) {
        result.skipped.push({ title: item.title, reason: `дубликат #${item.duplicateOf}` });
      } else {
        const issue = await createIssue(project.githubRepo, { title: item.title, body: item.body, labels: [project.label, `risk:${item.risk}`] });

        result.created.push({ number: issue.number, url: issue.html_url, title: issue.title });
      }
    }

    if (result.created.length > 0) {
      setIssueState(projectId, iid, { step: 'published', publishedAt: new Date().toISOString() });
      await sendClientEvent(hostname(), { type: 'issues_created', taskKey: `${projectId}:${iid}`, count: result.created.length }).catch(() => undefined);
    }

    return result;
  });
}

// Suggestions for the "which module" field — from the committed tree.
export async function handleListAnalysisModules(req: Request<Record<string, string>>, res: Response) {
  const { projectId } = req.params;

  await withStream(res, 'List analysis modules', async () => {
    const project = requireGithubProject(projectId);

    return { modules: await listModules(project.path) } satisfies AnalysisModulesType;
  });
}
