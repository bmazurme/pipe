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
  setLeakScanStrict,
} from './config-props';

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

export function handleAddTrackedProject(req: Request<Record<string, string>>, res: Response) {
  withSync(res, 'Add tracked project', () => addTrackedProject(req.body as TrackedProjectType));
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
