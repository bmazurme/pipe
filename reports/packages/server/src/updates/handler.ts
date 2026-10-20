import type { Request, Response } from 'express';

import { updateChecker } from './check';

// GET /api/update/status[?refresh=1] — { type: 'message', data: UpdateStatusType }, like /api/version.
export async function handleUpdateStatus(req: Request, res: Response) {
  const status = await updateChecker.status({ refresh: req.query.refresh === '1' });

  res.json({ type: 'message', data: status });
}
