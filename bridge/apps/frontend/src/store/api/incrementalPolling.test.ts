import { beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '..';
import { chatApi, workerApi } from '..';
import { DELTA_OVERLAP_MS, deltaSince } from './incrementalSince';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

// The endpoints are injected at runtime, so the base api's own type does not list them.
interface Row {
  id: number;
  status?: string;
  progress?: string | null;
}
interface Result {
  data?: Row[];
  isError?: boolean;
}
interface Endpoints {
  listJobs: { initiate: (arg: undefined, options: object) => unknown; select: () => (state: unknown) => Result };
  deleteJob: { initiate: (id: number) => unknown };
  listMessages: { initiate: (id: number, options: object) => unknown };
}
const workerEndpoints = workerApi.endpoints as unknown as Endpoints;
const chatEndpoints = chatApi.endpoints as unknown as Endpoints;
const run = (action: unknown) => store.dispatch(action as never) as unknown as Promise<Result>;

let urls: string[];
let answer: (url: string) => unknown;

beforeEach(() => {
  urls = [];
  store.dispatch(workerApi.util.resetApiState());
  store.dispatch(chatApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      urls.push(request.url);

      return json(answer(request.url));
    }),
  );
});

const job = (id: number, createdAt: string, updatedAt: string, status = 'queued') => ({
  id,
  status,
  createdAt,
  updatedAt,
});
const message = (id: number, createdAt: string, updatedAt: string, progress: string | null = null) => ({
  id,
  chatId: 1,
  createdAt,
  updatedAt,
  progress,
});

describe('deltaSince', () => {
  it('goes a few seconds back, so a write that committed just after the last poll is not missed', () => {
    expect(deltaSince('2026-10-16T12:00:10.000Z')).toBe(
      new Date(Date.parse('2026-10-16T12:00:10.000Z') - DELTA_OVERLAP_MS).toISOString(),
    );
    expect(deltaSince('not a date')).toBe('not a date');
  });
});

describe('listJobs polls incrementally', () => {
  const poll = () => run(workerEndpoints.listJobs.initiate(undefined, { forceRefetch: true }));

  it('fetches everything the first time, then only what changed, merged into what it has', async () => {
    answer = (url) =>
      url.includes('updatedAfter')
        ? [
            job(2, '2026-10-16T10:00:00.000Z', '2026-10-16T12:05:00.000Z', 'running'),
            job(3, '2026-10-16T11:00:00.000Z', '2026-10-16T12:05:00.000Z'),
          ]
        : [
            job(2, '2026-10-16T10:00:00.000Z', '2026-10-16T12:00:00.000Z'),
            job(1, '2026-10-16T09:00:00.000Z', '2026-10-16T09:30:00.000Z', 'succeeded'),
          ];

    const first = await poll();

    expect(urls.at(-1)).toMatch(/\/worker\/jobs$/);
    expect(first.data?.map((j) => j.id)).toEqual([2, 1]);

    const second = await poll();

    expect(urls.at(-1)).toContain('updatedAfter=');
    expect(decodeURIComponent(urls.at(-1) as string)).toContain(
      `updatedAfter=${deltaSince('2026-10-16T12:00:00.000Z')}`,
    );
    // updated in place, new one added, ordered newest first, untouched one kept
    expect(second.data?.map((j) => [j.id, j.status])).toEqual([
      [3, 'queued'],
      [2, 'running'],
      [1, 'succeeded'],
    ]);
  });

  it('keeps the list as it is when nothing changed', async () => {
    answer = (url) =>
      url.includes('updatedAfter') ? [] : [job(1, '2026-10-16T09:00:00.000Z', '2026-10-16T09:30:00.000Z')];

    const first = await poll();
    const second = await poll();

    expect(second.data).toBe(first.data);
  });

  it('shows an error from a delta poll, without throwing away what it has', async () => {
    answer = () => [job(1, '2026-10-16T09:00:00.000Z', '2026-10-16T09:30:00.000Z')];
    await poll();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 })),
    );
    const failed = await poll();

    expect(failed.isError).toBe(true);
    expect(failed.data?.map((j) => j.id)).toEqual([1]);
  });

  it('removes a deleted job from the list at once (a delta poll can never tell about an absent row)', async () => {
    answer = (url) =>
      url.includes('updatedAfter')
        ? []
        : [
            job(2, '2026-10-16T10:00:00.000Z', '2026-10-16T12:00:00.000Z'),
            job(1, '2026-10-16T09:00:00.000Z', '2026-10-16T09:30:00.000Z'),
          ];
    await poll();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) =>
        request.method === 'DELETE' ? new Response(null, { status: 204 }) : json(answer(request.url)),
      ),
    );
    await run(workerEndpoints.deleteJob.initiate(2));

    const after = workerEndpoints.listJobs.select()(store.getState());

    expect(after.data?.map((j) => j.id)).toEqual([1]);
  });
});

describe('listMessages polls incrementally', () => {
  const poll = () => run(chatEndpoints.listMessages.initiate(1, { forceRefetch: true }));

  it("fetches the thread once, then only the messages that changed (a reply's progress growing)", async () => {
    answer = (url) =>
      url.includes('updatedAfter')
        ? [message(2, '2026-10-16T12:00:05.000Z', '2026-10-16T12:00:09.000Z', 'Par')]
        : [
            message(1, '2026-10-16T12:00:00.000Z', '2026-10-16T12:00:00.000Z'),
            message(2, '2026-10-16T12:00:05.000Z', '2026-10-16T12:00:06.000Z'),
          ];

    await poll();
    expect(urls.at(-1)).toMatch(/\/chat\/chats\/1\/messages$/);

    const second = await poll();

    expect(urls.at(-1)).toContain('/chat/chats/1/messages?updatedAfter=');
    expect(second.data?.map((m) => [m.id, m.progress])).toEqual([
      [1, null],
      [2, 'Par'],
    ]);
  });

  it('keeps a thread in the order it was written, however often a message is merged in', async () => {
    answer = (url) =>
      url.includes('updatedAfter')
        ? [message(1, '2026-10-16T12:00:00.000Z', '2026-10-16T12:10:00.000Z', 'x')]
        : [
            message(1, '2026-10-16T12:00:00.000Z', '2026-10-16T12:00:00.000Z'),
            message(2, '2026-10-16T12:00:05.000Z', '2026-10-16T12:00:06.000Z'),
          ];

    await poll();
    const second = await poll();

    expect(second.data?.map((m) => m.id)).toEqual([1, 2]);
  });
});
