import type { Request, Response } from 'express';

import { getProjectDict, addProjectCode, removeProjectCode } from './project-dict-props';
import { withStream } from '../utils/stream';

export async function handleGetProjectDict(req: Request<Record<string, string>>, res: Response) {
  await withStream(res, 'Get project dict', async () => {
    return getProjectDict();
  });
}

export async function handleAddProjectCode(req: Request<Record<string, string>>, res: Response) {
  const { code, label } = req.body;
  await withStream(res, 'Add project code', async () => {
    return addProjectCode(code, label);
  });
}

export async function handleRemoveProjectCode(req: Request<Record<string, string>>, res: Response) {
  const { code } = req.params;
  await withStream(res, 'Remove project code', async () => {
    return removeProjectCode(code);
  });
}
