import type { Request, Response } from 'express';
import type { StreamEvent } from '@reports/shared';

import { getProjectDict, addProjectCode, removeProjectCode } from './project-dict-props';

export async function handleGetProjectDict(req: Request, res: Response) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  const sendEvent = (event: StreamEvent) => {
    res.write(JSON.stringify(event) + '\n');
  };

  try {
    sendEvent({ type: 'message', data: getProjectDict() });
    res.end();
  } catch (error) {
    console.error('Get project dict error:', error);
    sendEvent({
      type: 'error',
      data: error instanceof Error ? error.message : 'Unknown error',
    });
    res.end();
  }
}

export async function handleAddProjectCode(req: Request, res: Response) {
  const { code, label } = req.body;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  const sendEvent = (event: StreamEvent) => {
    res.write(JSON.stringify(event) + '\n');
  };

  try {
    sendEvent({ type: 'message', data: addProjectCode(code, label) });
    res.end();
  } catch (error) {
    console.error('Add project code error:', error);
    sendEvent({
      type: 'error',
      data: error instanceof Error ? error.message : 'Unknown error',
    });
    res.end();
  }
}

export async function handleRemoveProjectCode(req: Request, res: Response) {
  const { code } = req.params;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  const sendEvent = (event: StreamEvent) => {
    res.write(JSON.stringify(event) + '\n');
  };

  try {
    sendEvent({ type: 'message', data: removeProjectCode(code) });
    res.end();
  } catch (error) {
    console.error('Remove project code error:', error);
    sendEvent({
      type: 'error',
      data: error instanceof Error ? error.message : 'Unknown error',
    });
    res.end();
  }
}
