import {
  decide,
  type BoardFacts,
  FAILED_RETRY_MS,
  inWindow,
  SETTLE_MS,
  validateWindow,
  workerNameOf,
  workersBehind,
} from './worker-auto-update';

const OLD = `sha256:${'1'.repeat(64)}`;
const NEW = `sha256:${'2'.repeat(64)}`;
const NOW = new Date('2026-11-27T01:00:00Z'); // 04:00 Moscow
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const worker = (digest: string | undefined, name = 'pipe-worker-pi-red') => ({
  name,
  image: 'ghcr.io/x/pipe-worker:stable',
  running: true,
  ...(digest ? { digest } : {}),
});

const board = (over: Partial<BoardFacts> = {}): BoardFacts => ({
  host: 'ubuntu-red',
  reportedAt: minutesAgo(5),
  workers: [worker(OLD)],
  latest: NEW,
  pending: false,
  last: null,
  busyJobs: 0,
  fresh: true,
  ...over,
});

describe('inWindow', () => {
  it("is true inside the window in the owner's timezone, false outside", () => {
    expect(inWindow('03:00-05:00', 'Europe/Moscow', NOW)).toBe(true);
    expect(
      inWindow(
        '03:00-05:00',
        'Europe/Moscow',
        new Date('2026-11-27T09:00:00Z'),
      ),
    ).toBe(false);
  });

  it('handles a window that crosses midnight', () => {
    expect(
      inWindow(
        '23:00-02:00',
        'Europe/Moscow',
        new Date('2026-11-27T21:30:00Z'),
      ),
    ).toBe(true);
    expect(
      inWindow(
        '23:00-02:00',
        'Europe/Moscow',
        new Date('2026-11-27T10:00:00Z'),
      ),
    ).toBe(false);
  });

  it('is never open for a window it cannot read, or one that is «off»', () => {
    for (const bad of ['', 'off', 'soon', '25:00-26:00', '03:00-03:00'])
      expect(inWindow(bad, 'Europe/Moscow', NOW)).toBe(false);
  });
});

describe('validateWindow', () => {
  it('accepts a window and says why not for the rest', () => {
    expect(validateWindow('03:00-05:00')).toBeNull();
    expect(validateWindow('off')).toMatch(/выключите автообновление/);
    expect(validateWindow('whenever')).toMatch(/Окно must look like/);
  });
});

describe('workersBehind', () => {
  it('names the containers on a release other than stable', () => {
    expect(
      workersBehind([worker(OLD, 'a'), worker(NEW, 'b')], NEW).map(
        (w) => w.name,
      ),
    ).toEqual(['a']);
  });

  it('never calls «I do not know» behind: no digest, or no latest', () => {
    expect(workersBehind([worker(undefined)], NEW)).toEqual([]);
    expect(workersBehind([worker(OLD)], undefined)).toEqual([]);
  });
});

describe('workerNameOf', () => {
  it('is the worker the container is', () => {
    expect(workerNameOf('pipe-worker-pi-red')).toBe('pi-red');
  });
});

describe('decide', () => {
  const now = { now: NOW, anyOtherBusy: false };

  it('updates a board that is behind, reported lately and has nothing running', () => {
    expect(decide(board(), now)).toEqual({ update: true, digest: NEW });
  });

  it.each([
    ['up to date', board({ workers: [worker(NEW)] })],
    ['the board has not reported lately', board({ fresh: false })],
    ['a decision is already waiting', board({ pending: true })],
    ['1 job(s) running on its workers', board({ busyJobs: 1 })],
  ])('does not when: %s', (why, facts) => {
    expect(decide(facts, now)).toEqual({ update: false, why });
  });

  it('does not update while another board is being updated, or has just been (one at a time)', () => {
    expect(decide(board(), { now: NOW, anyOtherBusy: true })).toEqual({
      update: false,
      why: 'another board is being updated or has just been',
    });
  });

  it('does not act on a report older than the last update — it still says «behind»', () => {
    const last = {
      status: 'applied',
      finishedAt: minutesAgo(2),
      targetDigest: NEW,
    };

    expect(decide(board({ last, reportedAt: minutesAgo(5) }), now)).toEqual({
      update: false,
      why: 'the report is older than the last update',
    });
  });

  it('lets the board settle after an update', () => {
    const last = {
      status: 'applied',
      finishedAt: minutesAgo(SETTLE_MS / 60_000 - 1),
      targetDigest: OLD,
    };

    expect(decide(board({ last, reportedAt: minutesAgo(1) }), now)).toEqual({
      update: false,
      why: 'the last update was just now',
    });
  });

  it('does not try a release again that already failed on this board — but a NEWER release, or a week later, yes', () => {
    const failed = (target: string, ago: number) => ({
      status: 'failed',
      finishedAt: minutesAgo(ago),
      targetDigest: target,
    });

    expect(decide(board({ last: failed(NEW, 60) }), now)).toEqual({
      update: false,
      why: 'this release already failed here',
    });
    expect(decide(board({ last: failed(OLD, 60) }), now)).toEqual({
      update: true,
      digest: NEW,
    });
    expect(
      decide(board({ last: failed(NEW, FAILED_RETRY_MS / 60_000 + 60) }), now),
    ).toEqual({ update: true, digest: NEW });
  });

  it('an applied update of the same release does not block (the report says behind only if it is)', () => {
    const last = {
      status: 'applied',
      finishedAt: minutesAgo(120),
      targetDigest: NEW,
    };

    expect(decide(board({ last }), now)).toEqual({ update: true, digest: NEW });
  });
});
