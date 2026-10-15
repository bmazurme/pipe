import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const exportToCsv = vi.fn();

vi.mock('./export-to-csv', () => ({ exportToCsv: (...args: unknown[]) => exportToCsv(...args) }));
vi.mock('../settings/props', () => ({
  getSettings: () => ({ gitlabUrl: 'http://gitlab.test', privateToken: 't', userId: '1' }),
}));
vi.mock('./project-dict-props', () => ({ getProjectDict: () => ({}) }));
vi.mock('./build-name', () => ({ buildName: () => 'report.csv' }));

import { handleReport } from './handler';

function makeRes() {
  const written: string[] = [];
  const res = {
    setHeader: vi.fn(),
    write: vi.fn((chunk: string) => written.push(chunk)),
    end: vi.fn(),
  };
  const events = () => written.map((l) => JSON.parse(l));
  return { res: res as unknown as Response, raw: res, events };
}

const issue = {
  id: 1,
  iid: 7,
  title: 'Task',
  project_id: 3,
  state: 'opened',
  created_at: '2024-01-01',
  time_stats: { human_time_estimate: '2h' },
};

describe('handleReport', () => {
  beforeEach(() => {
    exportToCsv.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('streams an error event (no message) when GitLab responds with 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const { res, raw, events } = makeRes();

    await handleReport({} as Request, res);

    const types = events().map((e) => e.type);
    expect(types).toEqual(['error']);
    expect(events()[0].data).toContain('500');
    expect(raw.end).toHaveBeenCalledTimes(1);
    expect(exportToCsv).not.toHaveBeenCalled();
  });

  it('still sends the report when the CSV write fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [issue] }),
    );
    exportToCsv.mockRejectedValue(new Error('disk full'));
    const { res, raw, events } = makeRes();

    await handleReport({} as Request, res);

    const types = events().map((e) => e.type);
    expect(types).toEqual(['message']);
    expect(events()[0].data).toHaveLength(2);
    expect(raw.end).toHaveBeenCalledTimes(1);
  });
});
