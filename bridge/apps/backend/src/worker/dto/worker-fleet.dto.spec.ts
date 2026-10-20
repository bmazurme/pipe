import { Worker } from '../entities/worker.entity';
import { WorkerResponseDto } from './worker-fleet.dto';

const now = new Date('2026-10-14T12:00:00Z');

function worker(over: Partial<Worker> = {}): Worker {
  return {
    id: 1,
    userId: 7,
    name: 'green',
    enabled: true,
    keyHash: 'hash',
    keyPrefix: 'brw_AAAAAAAA',
    enrollCodeHash: null,
    enrollExpiresAt: null,
    lastSeenAt: now,
    hostname: 'box',
    version: '1.0.0',
    models: null,
    pollIntervalSec: 10,
    jobTimeoutSec: 1800,
    proxyUrl: null,
    chatEnabled: true,
    createdAt: now,
    updatedAt: now,
    ...over,
  } as Worker;
}

describe('WorkerResponseDto.fromWorker — the state a worker shows in the list', () => {
  const state = (w: Worker, activeJobs: number, online: boolean) =>
    WorkerResponseDto.fromWorker(w, activeJobs, online, now).state;

  it('pending until it has redeemed its code', () => {
    expect(state(worker({ keyHash: null }), 0, false)).toBe('pending');
  });

  it('idle when it is online with nothing to do', () => {
    expect(state(worker(), 0, true)).toBe('idle');
  });

  it('busy when it holds a job', () => {
    expect(state(worker(), 1, true)).toBe('busy');
  });

  it('offline when it has not been heard from lately', () => {
    expect(state(worker(), 0, false)).toBe('offline');
  });

  it('paused wins over everything an enrolled worker can be', () => {
    expect(state(worker({ enabled: false }), 1, true)).toBe('paused');
    expect(state(worker({ enabled: false }), 0, false)).toBe('paused');
  });

  it('never exposes the key hash, only a short prefix', () => {
    const dto = WorkerResponseDto.fromWorker(worker(), 0, true, now);

    expect(JSON.stringify(dto)).not.toContain('"hash"');
    expect(dto).not.toHaveProperty('keyHash');
    expect(dto).not.toHaveProperty('enrollCodeHash');
    expect(dto.keyPrefix).toBe('brw_AAAAAAAA');
  });

  describe('enrollment', () => {
    it('is pending while the code is still valid', () => {
      const dto = WorkerResponseDto.fromWorker(
        worker({
          keyHash: null,
          enrollCodeHash: 'h',
          enrollExpiresAt: new Date(now.getTime() + 60_000),
        }),
        0,
        false,
        now,
      );

      expect(dto.enrollmentPending).toBe(true);
    });

    it('is no longer pending once the code expired — the page offers a new one', () => {
      const dto = WorkerResponseDto.fromWorker(
        worker({
          keyHash: null,
          enrollCodeHash: 'h',
          enrollExpiresAt: new Date(now.getTime() - 1),
        }),
        0,
        false,
        now,
      );

      expect(dto.state).toBe('pending');
      expect(dto.enrollmentPending).toBe(false);
    });

    it('is not pending for a worker that is already enrolled', () => {
      expect(
        WorkerResponseDto.fromWorker(worker(), 0, true, now).enrollmentPending,
      ).toBe(false);
    });
  });
});

describe('WorkerResponseDto.legacy', () => {
  it('is a worker known only by name: no id, idle or busy or offline', () => {
    const idle = WorkerResponseDto.legacy('old', now, 0, true);

    expect(idle).toMatchObject({
      id: null,
      kind: 'legacy',
      state: 'idle',
      name: 'old',
    });
    expect(WorkerResponseDto.legacy('old', now, 2, true).state).toBe('busy');
    expect(WorkerResponseDto.legacy('old', now, 0, false).state).toBe(
      'offline',
    );
  });
});

describe('WorkerResponseDto.fromWorker — proxy credentials', () => {
  it('masks user:pass in the owner view', () => {
    const dto = WorkerResponseDto.fromWorker(
      worker({ proxyUrl: 'http://u:p@proxy:3128' }),
      0,
      true,
      now,
    );

    expect(dto.proxyUrl).toBe('http://***@proxy:3128');
    expect(dto.proxyHasCredentials).toBe(true);
  });

  it('returns a credential-less proxy as it is', () => {
    const dto = WorkerResponseDto.fromWorker(
      worker({ proxyUrl: 'http://proxy:3128' }),
      0,
      true,
      now,
    );

    expect(dto.proxyUrl).toBe('http://proxy:3128');
    expect(dto.proxyHasCredentials).toBe(false);
  });
});
