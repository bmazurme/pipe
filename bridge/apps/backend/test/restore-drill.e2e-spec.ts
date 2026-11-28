import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { SessionsService } from '../src/auth/sessions.service';
import { UsersService } from '../src/users/users.service';

// R7: the restore drill reports through the boards-agent route (a `boards` key is enough) and the Dashboard reads the verdict back.
describe('Restore drill (e2e)', () => {
  let app: INestApplication<App>;
  const ownerEmail = `e2e-drill-owner-${Date.now()}@ntlstl.test`;
  let accessToken: string;
  let boardsKey: string;

  const http = () => request(app.getHttpServer());

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

    const user = await app.get(UsersService).create({ email: ownerEmail });
    const session = await app
      .get(SessionsService)
      .createSession(user.id, 'jest', '127.0.0.1');

    accessToken = app
      .get(JwtService)
      .sign({ sub: user.id, sessionId: session.id });

    const key = await http()
      .post('/api/v1/auth/api-keys')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'drill', scope: 'boards' })
      .expect(201);

    boardsKey = key.body.token as string;
  });

  afterAll(async () => {
    delete process.env.EMAILS;
    await app.close();
  });

  it('is «never done» until a drill reports', async () => {
    const res = await http()
      .get('/api/v1/dashboard/restore-drill')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toMatchObject({
      status: 'warn',
      lastAt: null,
      recent: [],
    });
  });

  it('takes a good drill from a boards key and shows it, RPO and restore time included', async () => {
    const backup = new Date(Date.now() - 8 * 3_600_000)
      .toISOString()
      .replace(/[-:]|\.\d+/g, '');

    await http()
      .post('/api/v1/boards/agent/restore-drill')
      .set('X-Api-Key', boardsKey)
      .send({
        host: 'mac',
        ok: true,
        backupCreatedAt: backup,
        restoreSeconds: 75,
        tables: 41,
        rows: 12345,
        counts: { users: 2, jobs: 30 },
        lastMigration: 'AddRestoreDrills1800300000000',
      })
      .expect(204);

    const res = await http()
      .get('/api/v1/dashboard/restore-drill')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toMatchObject({
      status: 'ok',
      restoreSeconds: 75,
      backupAgeHours: 8,
      counts: { users: 2, jobs: 30 },
    });
    expect(res.body.recent).toHaveLength(1);
  });

  it('shows a failed drill as a problem even with a good one behind it', async () => {
    await http()
      .post('/api/v1/boards/agent/restore-drill')
      .set('X-Api-Key', boardsKey)
      .send({ host: 'mac', ok: false, error: 'checksum mismatch' })
      .expect(204);

    const res = await http()
      .get('/api/v1/dashboard/restore-drill')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.status).toBe('bad');
    expect(res.body.reasons[0]).toContain('checksum mismatch');
    expect(res.body.recent[0]).toMatchObject({ ok: false });
  });

  it('refuses a malformed report and an unauthenticated one', async () => {
    await http()
      .post('/api/v1/boards/agent/restore-drill')
      .set('X-Api-Key', boardsKey)
      .send({ host: 'mac', ok: 'yes' })
      .expect(400);
    await http()
      .post('/api/v1/boards/agent/restore-drill')
      .send({ host: 'mac', ok: true })
      .expect(401);
  });

  it('is not readable with a boards key (the Dashboard is a browser session)', async () => {
    await http()
      .get('/api/v1/dashboard/restore-drill')
      .set('X-Api-Key', boardsKey)
      .expect((res) => {
        expect([401, 403]).toContain(res.status);
      });
  });
});
