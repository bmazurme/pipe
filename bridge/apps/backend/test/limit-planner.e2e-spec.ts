import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { getRepositoryToken } from '@nestjs/typeorm';
import cookieParser from 'cookie-parser';
import { zipSync } from 'fflate';
import type { App } from 'supertest/types';
import { Repository } from 'typeorm';

import { AppModule } from '../src/app.module';
import type { ClaudeLimits } from '../src/worker/claude-limits';
import { ClaudeCredentialsService } from '../src/worker/claude-credentials.service';
import { Job, JobModel, JobStatus } from '../src/worker/entities/job.entity';
import { WorkerService } from '../src/worker/worker.service';
import { StorageService } from '../src/storage/storage.service';
import { UsersService } from '../src/users/users.service';

// R10: the Claude-limit planner on the real database — a job made by something automatic waits for the window to reset, moves to a token
// that has room, and is put back when it failed on the limit anyway. (The HTTP route makes jobs for a person, which the planner never touches.)
describe('Claude-limit planner (e2e)', () => {
  let app: INestApplication<App>;
  let userId: number;
  let jobs: Repository<Job>;
  const parcel = () =>
    Buffer.from(zipSync({ '__sync_manifest__.json': Buffer.from('{}') }));

  const limits = (
    utilization: number,
    resetsInMin: number,
    over: Partial<ClaudeLimits> = {},
  ): ClaudeLimits => ({
    status: 'allowed',
    rateLimitType: null,
    isUsingOverage: false,
    windows: {
      five_hour: {
        utilization,
        resetsAt: Math.round(Date.now() / 1000) + resetsInMin * 60,
      },
    },
    reportedAt: new Date().toISOString(),
    ...over,
  });

  const workers = () => app.get(WorkerService);
  const credentials = () => app.get(ClaudeCredentialsService);
  const newParcel = () =>
    app
      .get(StorageService)
      .createFromBuffer(userId, parcel(), `p-${Math.random()}.zip`);

  beforeAll(async () => {
    process.env.POSTGRES_DB = 'ntlstl-db-test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: async () => ({
          totalHits: 1,
          timeToExpire: 60,
          isBlocked: false,
          timeToBlockExpire: 0,
        }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    jobs = app.get(getRepositoryToken(Job));
    userId = (
      await app
        .get(UsersService)
        .create({ email: `e2e-limits-${Date.now()}@ntlstl.test` })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('holds an automatic job until the window resets, and a person’s job is left alone', async () => {
    const token = await credentials().create(userId, 'only', 'tok-1');

    await credentials().recordLimits(token.id, userId, limits(0.95, 120));

    const file = await newParcel();
    const held = await workers().create(
      userId,
      { sourceFileId: file.id, model: JobModel.Sonnet },
      undefined,
      'deferrable',
    );
    const saved = await jobs.findOneByOrFail({ id: held.id });

    expect(saved.deferrable).toBe(true);
    expect(saved.notBefore!.getTime()).toBeGreaterThan(
      Date.now() + 119 * 60_000,
    );
    expect(saved.logs).toContain('несрочная задача отложена до сброса лимита');

    // Held back: the worker's claim does not see it.
    expect(await workers().claim(userId, 'e2e-worker')).toBeNull();

    const person = await workers().create(userId, {
      sourceFileId: (await newParcel()).id,
      model: JobModel.Sonnet,
    });

    expect(
      (await jobs.findOneByOrFail({ id: person.id })).notBefore,
    ).toBeNull();
  });

  it('moves an automatic job to the token that has room, and puts it back after a failure on the limit', async () => {
    await credentials().recordLimits(
      (await credentials().planTokens(userId))[0].id,
      userId,
      limits(1, 60),
    );

    const spare = await credentials().create(userId, 'spare', 'tok-2');
    const file = await newParcel();
    const moved = await workers().create(
      userId,
      { sourceFileId: file.id, model: JobModel.Sonnet },
      undefined,
      'deferrable',
    );

    expect(
      (await jobs.findOneByOrFail({ id: moved.id })).claudeCredentialId,
    ).toBe(spare.id);

    // It ran on the spare token and failed on its limit: the report said "rejected", with the reset time.
    await credentials().recordLimits(
      spare.id,
      userId,
      limits(1, 90, { status: 'rejected', rateLimitType: 'five_hour' }),
    );
    await jobs.update(moved.id, {
      status: JobStatus.Failed,
      usedClaudeCredentialId: spare.id,
      errorMessage: 'rate limited',
      finishedAt: new Date(),
    });

    const again = await workers().requeueAfterLimit(
      await jobs.findOneByOrFail({ id: moved.id }),
    );

    expect(again).not.toBeNull();

    const next = await jobs.findOneByOrFail({ id: again!.id });

    expect(next.status).toBe(JobStatus.Queued);
    expect(next.deferrable).toBe(true);
    expect(next.notBefore!.getTime()).toBeGreaterThan(Date.now() + 89 * 60_000);
    expect(next.logs).toContain('упало на лимите плана Claude');
    expect(
      (await jobs.findOneByOrFail({ id: moved.id })).limitDeferredAt,
    ).not.toBeNull();
  });
});
