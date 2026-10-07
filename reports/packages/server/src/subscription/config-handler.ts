import type { Request, Response } from 'express';
import type { CommentTemplateType, DictionaryEntryType, EncryptionSettingsType, StreamEvent, TrackedProjectType } from '@reports/shared';

import {
  getSubscriptionConfig,
  addTrackedProject,
  removeTrackedProject,
  addDictionaryEntry,
  removeDictionaryEntry,
  updateDictionaryEntry,
  importDictionaryEntries,
  addCommentTemplate,
  removeCommentTemplate,
  setEncryptionSettings,
  generateAndSaveKeyPair,
  setAutoStartWorkerModel,
  setLeakScanStrict,
} from './config-props';
import { getRepo } from './github-client';

function sender(res: Response) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  return (event: StreamEvent) => {
    res.write(JSON.stringify(event) + '\n');
  };
}

function withSync(res: Response, label: string, run: () => unknown) {
  const sendEvent = sender(res);

  try {
    sendEvent({ type: 'message', data: run() });
  } catch (error) {
    console.error(`${label} error:`, error);
    sendEvent({ type: 'error', data: error instanceof Error ? error.message : 'Unknown error' });
  } finally {
    res.end();
  }
}

export function handleGetSubscriptionConfig(req: Request<Record<string, string>>, res: Response) {
  withSync(res, 'Get subscription config', () => getSubscriptionConfig());
}

// A GitHub repo is entered as 'owner/name'; the numeric repository id that
// becomes the project's key is resolved here, once, instead of asking the
// user to look it up.
export async function resolveTrackedProject(input: TrackedProjectType): Promise<TrackedProjectType> {
  if (input.provider !== 'github' && !input.githubRepo) {
    return input;
  }

  if (!input.githubRepo || !/^[\w.-]+\/[\w.-]+$/.test(input.githubRepo)) {
    throw new Error("Укажите GitHub-репозиторий в формате 'owner/name'");
  }

  const repo = await getRepo(input.githubRepo);

  return { ...input, provider: 'github', githubRepo: repo.fullName, gitlabProjectId: String(repo.id) };
}

export async function handleAddTrackedProject(req: Request<Record<string, string>>, res: Response) {
  const sendEvent = sender(res);

  try {
    sendEvent({ type: 'message', data: addTrackedProject(await resolveTrackedProject(req.body as TrackedProjectType)) });
  } catch (error) {
    console.error('Add tracked project error:', error);
    sendEvent({ type: 'error', data: error instanceof Error ? error.message : 'Unknown error' });
  } finally {
    res.end();
  }
}

export function handleRemoveTrackedProject(req: Request<Record<string, string>>, res: Response) {
  withSync(res, 'Remove tracked project', () => removeTrackedProject(req.params.gitlabProjectId));
}

export function handleAddDictionaryEntry(req: Request<Record<string, string>>, res: Response) {
  withSync(res, 'Add dictionary entry', () => addDictionaryEntry(req.body as DictionaryEntryType));
}

export function handleRemoveDictionaryEntry(req: Request<Record<string, string>>, res: Response) {
  withSync(res, 'Remove dictionary entry', () => removeDictionaryEntry(decodeURIComponent(req.params.key)));
}

export function handleUpdateDictionaryEntry(req: Request<Record<string, string>>, res: Response) {
  const oldKey = decodeURIComponent(req.params.key);

  withSync(res, 'Update dictionary entry', () => updateDictionaryEntry(oldKey, req.body as DictionaryEntryType));
}

export function handleImportDictionary(req: Request<Record<string, string>>, res: Response) {
  const { entries } = req.body as { entries: DictionaryEntryType[] };

  withSync(res, 'Import dictionary', () => importDictionaryEntries(Array.isArray(entries) ? entries : []));
}

export function handleAddCommentTemplate(req: Request<Record<string, string>>, res: Response) {
  withSync(res, 'Add comment template', () => addCommentTemplate(req.body as CommentTemplateType));
}

export function handleRemoveCommentTemplate(req: Request<Record<string, string>>, res: Response) {
  withSync(res, 'Remove comment template', () => removeCommentTemplate(req.params.id));
}

export function handleSetEncryptionSettings(req: Request<Record<string, string>>, res: Response) {
  withSync(res, 'Set encryption settings', () => setEncryptionSettings(req.body as EncryptionSettingsType));
}

export function handleGenerateEncryptionKeyPair(req: Request<Record<string, string>>, res: Response) {
  withSync(res, 'Generate encryption key pair', () => generateAndSaveKeyPair());
}

export function handleSetLeakScanStrict(req: Request<Record<string, string>>, res: Response) {
  const { leakScanStrict } = req.body as { leakScanStrict: boolean };

  withSync(res, 'Set leak scan strict mode', () => setLeakScanStrict(Boolean(leakScanStrict)));
}

export const WORKER_MODELS = ['sonnet', 'opus', 'gpt', 'deepseek', 'qwen'] as const;

// `model: null` (or an empty string) switches the automatic start off.
export function handleSetAutoStartWorkerModel(req: Request<Record<string, string>>, res: Response) {
  const { model } = req.body as { model?: string | null };

  withSync(res, 'Set auto-start worker model', () => {
    if (!model) return setAutoStartWorkerModel(undefined);

    if (!(WORKER_MODELS as readonly string[]).includes(model)) {
      throw new Error(`Неизвестная модель worker: ${model}`);
    }

    return setAutoStartWorkerModel(model as (typeof WORKER_MODELS)[number]);
  });
}
