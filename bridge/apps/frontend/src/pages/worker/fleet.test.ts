import { describe, expect, it } from 'vitest';

import type { FleetWorker } from '../../store/api';
import {
  canRun,
  describeAvailability,
  describeModels,
  enrollSnippets,
  fleetCounts,
  isOnline,
  pinnableWorkers,
} from './fleet';

function worker(over: Partial<FleetWorker> = {}): FleetWorker {
  return {
    id: 1,
    name: 'green',
    kind: 'managed',
    state: 'idle',
    enabled: true,
    lastSeenAt: '2026-10-14T12:00:00Z',
    activeJobs: 0,
    hostname: 'box',
    version: '1.0.0',
    models: null,
    pollIntervalSec: 10,
    jobTimeoutSec: 1800,
    proxyUrl: null,
    chatEnabled: true,
    keyPrefix: 'brw_AAAAAAAA',
    enrollmentPending: false,
    enrollmentExpiresAt: null,
    createdAt: '2026-10-14T11:00:00Z',
    claudeLimits: null,
    claudeCredentialId: null,
    ...over,
  };
}

describe('model support', () => {
  it('a worker without restrictions runs every model; a restricted one only its own', () => {
    expect(canRun(worker(), 'opus')).toBe(true);
    expect(canRun(worker({ models: ['gpt'] }), 'gpt')).toBe(true);
    expect(canRun(worker({ models: ['gpt'] }), 'opus')).toBe(false);
  });

  it('names the models in words', () => {
    expect(describeModels(null)).toBe('Все модели');
    expect(describeModels(['gpt', 'qwen'])).toBe('GPT, Qwen');
  });
});

describe('isOnline', () => {
  it('only an idle or busy worker is connected', () => {
    expect(isOnline(worker({ state: 'idle' }))).toBe(true);
    expect(isOnline(worker({ state: 'busy' }))).toBe(true);
    for (const state of ['pending', 'offline', 'paused'] as const) {
      expect(isOnline(worker({ state }))).toBe(false);
    }
  });
});

describe('pinnableWorkers', () => {
  const fleet = [
    worker({ id: 1, name: 'a' }),
    worker({ id: 2, name: 'paused', state: 'paused', enabled: false }),
    worker({ id: 3, name: 'new', state: 'pending' }),
    worker({ id: 4, name: 'offline', state: 'offline' }),
    worker({ id: 5, name: 'gpt-only', models: ['gpt'] }),
    worker({ id: null, name: 'old', kind: 'legacy' }),
  ];

  it('leaves out paused, not-yet-connected and legacy workers — bridge refuses to pin to them', () => {
    expect(pinnableWorkers(fleet, undefined).map((w) => w.name)).toEqual(['a', 'offline', 'gpt-only']);
  });

  it('keeps an offline worker (the job waits for it) and drops the ones that cannot run the model', () => {
    expect(pinnableWorkers(fleet, 'opus').map((w) => w.name)).toEqual(['a', 'offline']);
    expect(pinnableWorkers(fleet, 'gpt').map((w) => w.name)).toEqual(['a', 'offline', 'gpt-only']);
  });
});

describe('describeAvailability — what to expect if the job starts now', () => {
  it('no workers at all: the one thing to do first', () => {
    expect(describeAvailability([], 'sonnet', undefined)).toMatchObject({
      tone: 'danger',
    });
  });

  it('auto, a free worker: starts within seconds', () => {
    const result = describeAvailability([worker(), worker({ id: 2, state: 'busy' })], 'sonnet', undefined);

    expect(result).toMatchObject({ tone: 'success' });
    expect(result?.text).toContain('1 из 2');
  });

  it('auto, everybody busy: queued until the first frees up', () => {
    const result = describeAvailability([worker({ state: 'busy' })], 'sonnet', undefined);

    expect(result).toMatchObject({ tone: 'info' });
    expect(result?.text).toContain('занят');
  });

  it('auto, nobody online: waits in the queue', () => {
    const result = describeAvailability([worker({ state: 'offline' })], 'sonnet', undefined);

    expect(result).toMatchObject({ tone: 'warning' });
    expect(result?.text).toContain('Ни один worker не на связи');
  });

  it('auto, workers online but none set up for the model: says so', () => {
    const result = describeAvailability([worker({ models: ['gpt'] })], 'opus', undefined);

    expect(result).toMatchObject({ tone: 'warning' });
    expect(result?.text).toContain('Claude Opus');
  });

  it('a legacy worker counts for auto — it takes whatever is not pinned', () => {
    const result = describeAvailability([worker({ id: null, kind: 'legacy', name: 'old' })], 'sonnet', undefined);

    expect(result).toMatchObject({ tone: 'success' });
  });

  it('no model chosen yet: nothing to say', () => {
    expect(describeAvailability([worker()], undefined, undefined)).toBeNull();
  });

  describe('pinned to one worker', () => {
    it('free', () => {
      expect(describeAvailability([worker()], 'sonnet', 1)).toMatchObject({
        tone: 'success',
      });
    });
    it('busy: starts after the current job', () => {
      expect(describeAvailability([worker({ state: 'busy' })], 'sonnet', 1)).toMatchObject({ tone: 'info' });
    });
    it('offline: the job waits for it', () => {
      expect(describeAvailability([worker({ state: 'offline' })], 'sonnet', 1)).toMatchObject({ tone: 'warning' });
    });
    it('paused: it would not take it', () => {
      expect(describeAvailability([worker({ state: 'paused' })], 'sonnet', 1)).toMatchObject({ tone: 'danger' });
    });
    it('gone: pick another', () => {
      expect(describeAvailability([worker({ id: 2 })], 'sonnet', 9)).toMatchObject({ tone: 'danger' });
    });
  });
});

describe('fleetCounts', () => {
  it('counts workers by what they are doing', () => {
    expect(
      fleetCounts([
        worker({ id: 1 }),
        worker({ id: 2, state: 'busy' }),
        worker({ id: 3, state: 'paused' }),
        worker({ id: 4, state: 'pending' }),
        worker({ id: 5, state: 'offline' }),
      ]),
    ).toEqual({ total: 5, online: 2, free: 1, busy: 1, paused: 1, pending: 1 });
  });
});

describe('enrollSnippets', () => {
  const snippets = enrollSnippets('https://api.example.com', 'brn_code', 'ghcr.io/o/pipe-worker:stable');

  it('docker: one command that starts the worker with only the address and the one-time code', () => {
    expect(snippets.docker).toContain('-e BRIDGE_API_URL=https://api.example.com');
    expect(snippets.docker).toContain('-e WORKER_ENROLL_CODE=brn_code');
    expect(snippets.docker).toContain('-v pipe-worker-state:/app/.worker-state');
    expect(snippets.docker).toContain('ghcr.io/o/pipe-worker:stable');
  });

  it('never asks for an API key or any other secret', () => {
    for (const snippet of Object.values(snippets)) {
      expect(snippet).not.toMatch(/API_KEY|TOKEN|brk_|SECRET/);
    }
  });

  it('exec: the code goes through stdin to a worker that is already running', () => {
    expect(snippets.exec).toBe('echo brn_code | docker exec -i pipe-worker node dist/enrollCli.js -');
  });

  it('node: for a checkout, no Docker', () => {
    expect(snippets.node).toContain('export WORKER_ENROLL_CODE=brn_code');
  });
});
