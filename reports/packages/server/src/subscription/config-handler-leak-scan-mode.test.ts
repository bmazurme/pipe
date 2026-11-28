import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

// config-props writes a real JSON file under src/ — never let a test touch it.
const setLeakScanMode = vi.hoisted(() => vi.fn((mode: string) => ({ leakScanMode: mode })));
vi.mock('./config-props', () => ({ setLeakScanMode }));

const { handleSetLeakScanMode } = await import('./config-handler');

function run(body: unknown) {
  const written: string[] = [];
  const res = { write: (chunk: string) => written.push(chunk), end: vi.fn(), setHeader: vi.fn() } as unknown as Response;

  handleSetLeakScanMode({ body } as Request<Record<string, string>>, res);

  return written.join('').trim().split('\n').map((line) => JSON.parse(line) as { type: string; data: unknown });
}

beforeEach(() => setLeakScanMode.mockClear());

describe('handleSetLeakScanMode', () => {
  it.each(['credentials', 'all', 'warn'])('stores %s', (mode) => {
    expect(run({ mode })[0]).toEqual({ type: 'message', data: { leakScanMode: mode } });
    expect(setLeakScanMode).toHaveBeenCalledWith(mode);
  });

  it('rejects anything else without storing it', () => {
    const [event] = run({ mode: 'off' });

    expect(event.type).toBe('error');
    expect(String(event.data)).toMatch(/mode must be one of/);
    expect(run({})[0].type).toBe('error');
    expect(setLeakScanMode).not.toHaveBeenCalled();
  });
});
