import type { Request, Response } from 'express';

import { assertSelfUpdatable, readProgress, startUpdate } from './apply';
import { updateChecker } from './check';

// GET /api/update/status[?refresh=1] — { type: 'message', data: UpdateStatusType }, like /api/version.
export async function handleUpdateStatus(req: Request, res: Response) {
  const status = await updateChecker.status({ refresh: req.query.refresh === '1' });
  let selfUpdate = { available: true, reason: null as string | null };

  try {
    assertSelfUpdatable();
  } catch (error) {
    selfUpdate = { available: false, reason: error instanceof Error ? error.message : String(error) };
  }

  res.json({ type: 'message', data: { ...status, selfUpdate } });
}

// GET /api/update/progress — where a running (or the last) update stands: { type: 'message', data: UpdateProgressType | null }.
export function handleUpdateProgress(_req: Request, res: Response) {
  res.json({ type: 'message', data: readProgress() });
}

// POST /api/update/apply — downloads, checks and unpacks the newest release and starts the update; answers at once.
// JSON only: a page on another site can send a plain form POST to a local address, but not a JSON one without CORS allowing it.
export async function handleApplyUpdate(req: Request, res: Response) {
  if (!req.is('application/json')) {
    res.status(415).json({ type: 'error', data: 'Ожидался JSON-запрос' });
    return;
  }

  try {
    res.json({ type: 'message', data: await startUpdate() });
  } catch (error) {
    console.error('Apply update error:', error);
    res.json({ type: 'error', data: error instanceof Error ? error.message : 'Unknown error' });
  }
}
