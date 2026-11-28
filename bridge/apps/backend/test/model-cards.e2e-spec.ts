import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ThrottlerStorage } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Repository } from 'typeorm';

import { AppModule } from '../src/app.module';
import { SessionsService } from '../src/auth/sessions.service';
import { ImproveOutcome } from '../src/improve/entities/improve-outcome.entity';
import { UsersService } from '../src/users/users.service';

// A10: the model cards are the owner's, are built from the stored outcomes, and check the router's table against them.
describe('Model cards (e2e)', () => {
  let app: INestApplication<App>;
  const ownerEmail = `e2e-cards-owner-${Date.now()}@ntlstl.test`;
  let ownerToken: string;
  let strangerToken: string;
  let ownerId: number;
  const http = () => request(app.getHttpServer());

  async function session(email: string) {
    const user = await app.get(UsersService).create({ email });
    const s = await app
      .get(SessionsService)
      .createSession(user.id, 'jest', '127.0.0.1');

    return {
      id: user.id,
      token: app.get(JwtService).sign({ sub: user.id, sessionId: s.id }),
    };
  }

  beforeAll(async () => {
    process.env.POSTGRES_DB = 'ntlstl-db-test';
    process.env.EMAILS = ownerEmail;

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

    const owner = await session(ownerEmail);

    ownerId = owner.id;
    ownerToken = owner.token;
    strangerToken = (
      await session(`e2e-cards-stranger-${Date.now()}@ntlstl.test`)
    ).token;

    const outcomes: Repository<ImproveOutcome> = app.get(
      getRepositoryToken(ImproveOutcome),
    );
    const now = new Date();

    // Six pull requests on Haiku at tier 2 that all merged, one with a measured work time.
    for (let i = 0; i < 6; i++) {
      await outcomes.save(
        outcomes.create({
          userId: ownerId,
          prNumber: 900_000 + i,
          runId: 1,
          model: 'haiku',
          tier: 2,
          state: 'merged',
          firstCi: 'success',
          ciRepairs: 0,
          costUsd: 0.25,
          workSeconds: i === 0 ? 420 : null,
          openedAt: now,
          mergedAt: now,
          closedAt: now,
          escalatedFrom: null,
          reverted: false,
          checkedAt: now,
        }),
      );
    }
  });

  afterAll(async () => {
    delete process.env.EMAILS;
    await app.close();
  });

  it('builds a card per model × tier from the stored outcomes', async () => {
    const res = await http()
      .get('/api/v1/improve/quality/model-cards')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const cell = res.body.cells.find(
      (c: { model: string; tier: number }) =>
        c.model === 'haiku' && c.tier === 2,
    );

    expect(cell).toMatchObject({
      prs: 6,
      merged: 6,
      closeRate: 1,
      samples: 6,
      costPerMergedUsd: 0.25,
      medianWorkMinutes: 7,
      verdict: 'solid',
    });
    expect(res.body.rules.minSamples).toBe(5);
  });

  it('checks the router’s own table against them (advice only: nothing is changed)', async () => {
    const before = await http()
      .get('/api/v1/router/settings')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const res = await http()
      .get('/api/v1/improve/quality/model-cards?days=30')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(res.body.advice.map((a: { tier: number }) => a.tier)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(
      res.body.advice.find((a: { tier: number }) => a.tier === 2),
    ).toMatchObject({ current: 'haiku', status: 'keep' });

    const after = await http()
      .get('/api/v1/router/settings')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(after.body).toEqual(before.body);
  });

  it('is the owner’s, and unauthenticated is refused', async () => {
    await http()
      .get('/api/v1/improve/quality/model-cards')
      .set('Authorization', `Bearer ${strangerToken}`)
      .expect(403);
    await http().get('/api/v1/improve/quality/model-cards').expect(401);
  });
});
