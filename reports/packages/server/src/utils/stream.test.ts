import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Response } from 'express';

import { streamSender, withStream } from './stream';

function makeRes() {
  const chunks: string[] = [];
  const headers: Record<string, string> = {};
  const res = {
    setHeader: vi.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    write: vi.fn((chunk: string) => {
      chunks.push(chunk);
    }),
    end: vi.fn(),
  };

  return { res: res as unknown as Response, raw: res, chunks, headers };
}

describe('stream utils', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('streamSender sets headers and writes NDJSON lines', () => {
    const { res, chunks, headers } = makeRes();

    streamSender(res)({ type: 'message', data: { a: 1 } });

    expect(headers['Content-Type']).toBe('text/plain; charset=utf-8');
    expect(headers['Transfer-Encoding']).toBe('chunked');
    expect(chunks).toEqual(['{"type":"message","data":{"a":1}}\n']);
  });

  it('withStream sends the result as a message and ends the response', async () => {
    const { res, raw, chunks } = makeRes();

    await withStream(res, 'Test', async () => ({ ok: true }));

    expect(chunks).toEqual(['{"type":"message","data":{"ok":true}}\n']);
    expect(raw.end).toHaveBeenCalledTimes(1);
  });

  it('withStream sends the message of a thrown Error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { res, raw, chunks } = makeRes();

    await withStream(res, 'Test', async () => {
      throw new Error('boom');
    });

    expect(chunks).toEqual(['{"type":"error","data":"boom"}\n']);
    expect(raw.end).toHaveBeenCalledTimes(1);
  });

  it('withStream reports a non-Error throw as Unknown error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { res, raw, chunks } = makeRes();

    await withStream(res, 'Test', async () => {
      throw 'nope';
    });

    expect(chunks).toEqual(['{"type":"error","data":"Unknown error"}\n']);
    expect(raw.end).toHaveBeenCalledTimes(1);
  });
});
