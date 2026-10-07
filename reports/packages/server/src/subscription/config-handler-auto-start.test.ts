import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

// config-props writes a real JSON file under src/ — never let a test touch it.
const setAutoStartWorkerModel = vi.hoisted(() => vi.fn((model: string | undefined) => ({ autoStartWorkerModel: model })));
vi.mock('./config-props', () => ({ setAutoStartWorkerModel }));

const { handleSetAutoStartWorkerModel } = await import('./config-handler');

function run(body: unknown) {
  const written: string[] = [];
  const res = { write: (chunk: string) => written.push(chunk), end: vi.fn(), setHeader: vi.fn() } as unknown as Response;

  handleSetAutoStartWorkerModel({ body } as Request<Record<string, string>>, res);

  return written.join('').trim().split('\n').map((line) => JSON.parse(line) as { type: string; data: unknown });
}

beforeEach(() => setAutoStartWorkerModel.mockClear());

describe('handleSetAutoStartWorkerModel', () => {
  it('stores a known model', () => {
    expect(run({ model: 'opus' })[0]).toEqual({ type: 'message', data: { autoStartWorkerModel: 'opus' } });
    expect(setAutoStartWorkerModel).toHaveBeenCalledWith('opus');
  });

  it('switches the feature off for null or an empty string', () => {
    run({ model: null });
    run({ model: '' });

    expect(setAutoStartWorkerModel).toHaveBeenNthCalledWith(1, undefined);
    expect(setAutoStartWorkerModel).toHaveBeenNthCalledWith(2, undefined);
  });

  it('rejects an unknown model without storing anything', () => {
    const [event] = run({ model: 'gpt-9000' });

    expect(event.type).toBe('error');
    expect(String(event.data)).toMatch(/Неизвестная модель/);
    expect(setAutoStartWorkerModel).not.toHaveBeenCalled();
  });
});
