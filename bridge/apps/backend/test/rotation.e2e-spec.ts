import { randomBytes } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ThrottlerStorage } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';

import { AppModule } from '../src/app.module';
import { SessionsService } from '../src/auth/sessions.service';
import { ReencryptService } from '../src/rotation/reencrypt.service';
import { UsersService } from '../src/users/users.service';
import { ClaudeCredential } from '../src/worker/entities/claude-credential.entity';

// S11: the encryption key can be rotated (values move to the new key, nothing is lost, a value that does not decrypt is left alone), and the
// rotation calendar + the backup key's copy checks are the owner's.
describe('Key rotation (e2e)', () => {
  let app: INestApplication<App>;
  const ownerEmail = `e2e-rot-owner-${Date.now()}@ntlstl.test`;
  let ownerToken: string;
  let strangerToken: string;
  let boardsKey: string;
  let ownerId: number;
  const v1 = process.env.CREDENTIALS_ENC_KEY;
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

    const key = await http()
      .post('/api/v1/auth/api-keys')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'keys', scope: 'boards' })
      .expect(201);

    boardsKey = key.body.token as string;
    strangerToken = (
      await session(`e2e-rot-stranger-${Date.now()}@ntlstl.test`)
    ).token;
  });

  afterAll(async () => {
    delete process.env.EMAILS;
    await app.close();
  });

  describe('moving encrypted values to a new key', () => {
    let credentials: Repository<ClaudeCredential>;
    let service: ReencryptService;
    let dataSource: DataSource;
    const ids: number[] = [];
    let brokenId: number;

    const raw = async (id: number): Promise<string> =>
      (
        await dataSource.query(
          'SELECT token FROM claude_credentials WHERE id = $1',
          [id],
        )
      )[0].token;

    beforeAll(async () => {
      dataSource = app.get(DataSource);
      credentials = app.get(getRepositoryToken(ClaudeCredential));
      service = new ReencryptService(dataSource);

      for (const name of ['one', 'two']) {
        const row = await credentials.save(
          credentials.create({
            userId: ownerId,
            name,
            token: `sk-ant-oat-${name}`,
          }),
        );

        ids.push(row.id);
      }

      // A value in our shape that no key opens (the key it was written under is gone).
      const broken = await credentials.save(
        credentials.create({ userId: ownerId, name: 'broken', token: 'x' }),
      );

      brokenId = broken.id;
      await dataSource.query(
        'UPDATE claude_credentials SET token = $1 WHERE id = $2',
        ['v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAA', brokenId],
      );

      process.env.CREDENTIALS_ENC_KEY_V2 = randomBytes(32).toString('base64');
      process.env.CREDENTIALS_ENC_KEY_CURRENT = 'v2';
    });

    afterAll(async () => {
      // Put the shared test database back under v1 for the other suites.
      process.env.CREDENTIALS_ENC_KEY_CURRENT = 'v1';
      await service.run();
      await dataSource.query('DELETE FROM claude_credentials WHERE id = $1', [
        brokenId,
      ]);
      delete process.env.CREDENTIALS_ENC_KEY_V2;
      delete process.env.CREDENTIALS_ENC_KEY_CURRENT;
      process.env.CREDENTIALS_ENC_KEY = v1;
    });

    it('counts what is still under the old key, without changing anything', async () => {
      const before = await raw(ids[0]);
      const status = await service.status();

      expect(status.currentKeyId).toBe('v2');
      expect(status.pending).toBeGreaterThanOrEqual(3);
      expect(
        status.columns.find((c) => c.table === 'claude_credentials')?.byKey.v1,
      ).toBeGreaterThanOrEqual(3);
      expect(await raw(ids[0])).toBe(before);
    });

    it('a dry run reports and writes nothing', async () => {
      const before = await raw(ids[0]);
      const result = await service.run({ dryRun: true });

      expect(result.dryRun).toBe(true);
      expect(result.moved).toBeGreaterThanOrEqual(2);
      expect(await raw(ids[0])).toBe(before);
    });

    it('moves every value to v2, loses none, and leaves the one that does not decrypt exactly as it was', async () => {
      const result = await service.run();

      expect(result.moved).toBeGreaterThanOrEqual(2);
      expect(result.failed.map((f) => f.where)).toContain(
        `claude_credentials.token #${brokenId}`,
      );
      expect(result.failed.every((f) => !f.reason.includes('sk-ant'))).toBe(
        true,
      );

      for (const id of ids)
        expect((await raw(id)).startsWith('v2:')).toBe(true);

      expect(await raw(brokenId)).toBe(
        'v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAA',
      );
      expect((await credentials.findOneByOrFail({ id: ids[0] })).token).toBe(
        'sk-ant-oat-one',
      );
      expect((await credentials.findOneByOrFail({ id: ids[1] })).token).toBe(
        'sk-ant-oat-two',
      );
    });

    it('a second run has nothing left to move', async () => {
      const result = await service.run();

      expect(result.moved).toBe(0);
      expect(result.alreadyCurrent).toBeGreaterThanOrEqual(2);
    });

    it('refuses to start when the new key is not configured, touching nothing', async () => {
      process.env.CREDENTIALS_ENC_KEY_CURRENT = 'v7';

      await expect(service.run()).rejects.toThrow(
        /CREDENTIALS_ENC_KEY_V7 is required/,
      );

      process.env.CREDENTIALS_ENC_KEY_CURRENT = 'v2';
    });
  });

  describe('the calendar and the key copies', () => {
    it('lists the five things, asking for the dates nobody marked', async () => {
      const res = await http()
        .get('/api/v1/rotation')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.items.map((i: { key: string }) => i.key)).toEqual([
        'jwt',
        'enc-key',
        'age-key',
        'telegram-bot',
        'db-password',
      ]);
      expect(res.body.status).toBe('warn');
      expect(res.body.keyCopies.verified).toBe(0);
    });

    it('marks a rotation, and the interval starts from it', async () => {
      await http()
        .post('/api/v1/rotation/jwt/rotated')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({})
        .expect(204);

      const res = await http()
        .get('/api/v1/rotation')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const jwt = res.body.items.find((i: { key: string }) => i.key === 'jwt');

      expect(jwt).toMatchObject({ status: 'ok', daysLeft: 365 });
      expect(jwt.lastRotatedAt).toBeTruthy();
    });

    it('refuses an unknown key, the age key, and a date in the future', async () => {
      const mark = (key: string, body: object = {}) =>
        http()
          .post(`/api/v1/rotation/${key}/rotated`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send(body);

      await mark('nope').expect(400);
      await mark('age-key').expect(400);
      await mark('jwt', { at: '2999-01-01T00:00:00Z' }).expect(400);
    });

    it('takes key checks from a boards key and counts verified copies', async () => {
      for (const label of ['mac', 'usb']) {
        await http()
          .post('/api/v1/boards/agent/key-check')
          .set('X-Api-Key', boardsKey)
          .send({ label, ok: true, backupCreatedAt: '20261209T030000Z' })
          .expect(204);
      }

      const res = await http()
        .get('/api/v1/rotation')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.keyCopies).toMatchObject({ verified: 2, status: 'ok' });
      expect(
        res.body.items.find((i: { key: string }) => i.key === 'age-key').status,
      ).toBe('ok');
    });

    it('a copy that fails shows as bad, keeping when it last worked', async () => {
      await http()
        .post('/api/v1/boards/agent/key-check')
        .set('X-Api-Key', boardsKey)
        .send({
          label: 'usb',
          ok: false,
          error: 'no identity matched any of the recipients',
        })
        .expect(204);

      const res = await http()
        .get('/api/v1/rotation')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const usb = res.body.keyCopies.copies.find(
        (c: { label: string }) => c.label === 'usb',
      );

      expect(res.body.keyCopies.status).toBe('bad');
      expect(usb).toMatchObject({
        ok: false,
        error: 'no identity matched any of the recipients',
      });
      expect(usb.lastOkAt).toBeTruthy();
    });

    it('refuses a malformed key check and anything unauthenticated', async () => {
      await http()
        .post('/api/v1/boards/agent/key-check')
        .set('X-Api-Key', boardsKey)
        .send({ label: 'bad label!!', ok: true })
        .expect(400);
      await http()
        .post('/api/v1/boards/agent/key-check')
        .send({ label: 'mac', ok: true })
        .expect(401);
    });

    it('is the owner’s: another account, and a boards key on the calendar itself, are refused', async () => {
      await http()
        .get('/api/v1/rotation')
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(403);
      await http()
        .get('/api/v1/rotation')
        .set('X-Api-Key', boardsKey)
        .expect((res) => {
          expect([401, 403]).toContain(res.status);
        });
    });
  });
});
