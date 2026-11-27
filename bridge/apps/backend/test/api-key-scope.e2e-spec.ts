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

// S5 against the real guards: the scopes of a personal API key, the default term, and the rotation that checks the old key is dead.
describe('API key scopes, term and rotation (e2e)', () => {
  let app: INestApplication<App>;

  async function authenticatedUser() {
    const user = await app.get(UsersService).create({
      email: `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@ntlstl.test`,
    });
    const session = await app
      .get(SessionsService)
      .createSession(user.id, 'jest', '127.0.0.1');
    const accessToken = app
      .get(JwtService)
      .sign({ sub: user.id, sessionId: session.id });

    return { userId: user.id, accessToken };
  }

  const http = () => request(app.getHttpServer());
  const authed = (req: request.Test, token: string) =>
    req.set('Authorization', `Bearer ${token}`);

  async function makeKey(token: string, body: Record<string, unknown>) {
    const res = await authed(
      http().post('/api/v1/auth/api-keys').send(body),
      token,
    ).expect(201);

    return res.body as {
      id: number;
      token: string;
      scope: string | null;
      expiresAt: string | null;
    };
  }

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
  });

  afterAll(async () => {
    await app.close();
  });

  describe('the term', () => {
    it('is 90 days when not given', async () => {
      const { accessToken } = await authenticatedUser();
      const key = await makeKey(accessToken, { name: 'default-term' });
      const days =
        (new Date(key.expiresAt as string).getTime() - Date.now()) / 86_400_000;

      expect(days).toBeGreaterThan(89.9);
      expect(days).toBeLessThan(90.1);
    });

    it('is never only when asked for with null', async () => {
      const { accessToken } = await authenticatedUser();

      expect(
        (await makeKey(accessToken, { name: 'never', expiresInDays: null }))
          .expiresAt,
      ).toBeNull();
    });

    it('takes 30, 90 and 365, and nothing else', async () => {
      const { accessToken } = await authenticatedUser();

      expect(
        (await makeKey(accessToken, { name: 'a', expiresInDays: 30 }))
          .expiresAt,
      ).not.toBeNull();
      await authed(
        http()
          .post('/api/v1/auth/api-keys')
          .send({ name: 'b', expiresInDays: 45 }),
        accessToken,
      ).expect(400);
    });
  });

  describe('scopes', () => {
    it('refuses a scope that does not exist', async () => {
      const { accessToken } = await authenticatedUser();

      await authed(
        http()
          .post('/api/v1/auth/api-keys')
          .send({ name: 'x', scope: 'admin' }),
        accessToken,
      ).expect(400);
    });

    it('a full key calls routes of every kind', async () => {
      const { accessToken } = await authenticatedUser();
      const key = await makeKey(accessToken, { name: 'full' });

      await http()
        .get('/api/v1/chat/chats')
        .set('X-Api-Key', key.token)
        .expect(200);
      await http()
        .get('/api/v1/storage')
        .set('X-Api-Key', key.token)
        .expect(200);
    });

    it('a readonly key reads and cannot write or download', async () => {
      const { accessToken } = await authenticatedUser();
      const key = await makeKey(accessToken, { name: 'ro', scope: 'readonly' });

      expect(key.scope).toBe('readonly');
      await http()
        .get('/api/v1/storage')
        .set('X-Api-Key', key.token)
        .expect(200);
      await http()
        .get('/api/v1/chat/chats')
        .set('X-Api-Key', key.token)
        .expect(200);
      await http()
        .delete('/api/v1/storage/999999')
        .set('X-Api-Key', key.token)
        .expect(403);
      await http()
        .post('/api/v1/storage')
        .set('X-Api-Key', key.token)
        .expect(403);
      await http()
        .get('/api/v1/storage/999999/download')
        .set('X-Api-Key', key.token)
        .expect(403);
    });

    it('a reports-sync key reaches Storage and not the rest', async () => {
      const { accessToken } = await authenticatedUser();
      const key = await makeKey(accessToken, {
        name: 'reports',
        scope: 'reports-sync',
      });

      await http()
        .get('/api/v1/storage')
        .set('X-Api-Key', key.token)
        .expect(200);
      // a route that accepts any key, outside what reports calls
      await http()
        .get('/api/v1/chat/chats')
        .set('X-Api-Key', key.token)
        .expect(403);
    });

    it('a boards key still reaches only the board agent routes', async () => {
      const { accessToken } = await authenticatedUser();
      const key = await makeKey(accessToken, {
        name: 'boards',
        scope: 'boards',
      });

      await http()
        .get('/api/v1/storage')
        .set('X-Api-Key', key.token)
        .expect(403);
    });
  });

  describe('rotation', () => {
    it('gives a new key of the same name and scope, and the old one stops working', async () => {
      const { accessToken } = await authenticatedUser();
      const old = await makeKey(accessToken, {
        name: 'rotate-me',
        scope: 'readonly',
        expiresInDays: 30,
      });

      await http()
        .get('/api/v1/storage')
        .set('X-Api-Key', old.token)
        .expect(200);

      const rotated = await authed(
        http().post(`/api/v1/auth/api-keys/${old.id}/rotate`),
        accessToken,
      ).expect(201);

      expect(rotated.body).toMatchObject({
        name: 'rotate-me',
        scope: 'readonly',
      });
      expect(rotated.body.token).not.toBe(old.token);
      expect(rotated.body.id).not.toBe(old.id);

      const days =
        (new Date(rotated.body.expiresAt).getTime() - Date.now()) / 86_400_000;

      expect(days).toBeGreaterThan(29.9);
      expect(days).toBeLessThan(30.1);

      await http()
        .get('/api/v1/storage')
        .set('X-Api-Key', old.token)
        .expect(401);
      await http()
        .get('/api/v1/storage')
        .set('X-Api-Key', rotated.body.token)
        .expect(200);

      const list = await authed(
        http().get('/api/v1/auth/api-keys'),
        accessToken,
      ).expect(200);

      expect(list.body.map((row: { id: number }) => row.id)).toEqual([
        rotated.body.id,
      ]);
    });

    it("is a 404 for an unknown key, a revoked one and another user's key", async () => {
      const mine = await authenticatedUser();
      const theirs = await authenticatedUser();
      const key = await makeKey(theirs.accessToken, { name: 'theirs' });

      await authed(
        http().post('/api/v1/auth/api-keys/999999/rotate'),
        mine.accessToken,
      ).expect(404);
      await authed(
        http().post(`/api/v1/auth/api-keys/${key.id}/rotate`),
        mine.accessToken,
      ).expect(404);
      await http()
        .get('/api/v1/storage')
        .set('X-Api-Key', key.token)
        .expect(200);

      await authed(
        http().delete(`/api/v1/auth/api-keys/${key.id}`),
        theirs.accessToken,
      ).expect(200);
      await authed(
        http().post(`/api/v1/auth/api-keys/${key.id}/rotate`),
        theirs.accessToken,
      ).expect(404);
    });

    it('wants a browser session', async () => {
      await http().post('/api/v1/auth/api-keys/1/rotate').expect(401);
    });
  });
});
