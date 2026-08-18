import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { SessionsService } from '../src/auth/sessions.service';
import { UsersService } from '../src/users/users.service';

// Runs against a dedicated `ntlstl-db-test` database on the same Postgres
// instance docker-compose.yml provides for local dev (never the real
// ntlstl-db) — created once with `createdb ntlstl-db-test`; schema is
// auto-synchronized on connect since NODE_ENV isn't 'production' here.
describe('Purge API (e2e)', () => {
  let app: INestApplication<App>;

  async function authenticatedUser() {
    const usersService = app.get(UsersService);
    const sessionsService = app.get(SessionsService);
    const jwtService = app.get(JwtService);

    const user = await usersService.create({
      email: `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@ntlstl.test`,
    });
    const session = await sessionsService.createSession(
      user.id,
      'jest',
      '127.0.0.1',
    );
    const accessToken = jwtService.sign({
      sub: user.id,
      sessionId: session.id,
    });

    return { userId: user.id, accessToken };
  }

  function authed(req: request.Test, token: string): request.Test {
    return req.set('Authorization', `Bearer ${token}`);
  }

  beforeAll(async () => {
    process.env.POSTGRES_DB = 'ntlstl-db-test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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

  describe('/api/v1/purge', () => {
    it('rejects requests without a bearer token', () => {
      return request(app.getHttpServer()).get('/api/v1/purge').expect(401);
    });

    it('supports the full create/list/update/delete lifecycle', async () => {
      const { accessToken } = await authenticatedUser();

      const created = await authed(
        request(app.getHttpServer())
          .post('/api/v1/purge')
          .send({ key: 'e2e-key', value: 'e2e-value' }),
        accessToken,
      ).expect(201);
      expect(created.body).toMatchObject({
        key: 'e2e-key',
        value: 'e2e-value',
      });
      const id = created.body.id;

      const list = await authed(
        request(app.getHttpServer()).get('/api/v1/purge'),
        accessToken,
      ).expect(200);
      expect(list.body).toContainEqual(created.body);

      const updated = await authed(
        request(app.getHttpServer())
          .patch(`/api/v1/purge/${id}`)
          .send({ value: 'changed' }),
        accessToken,
      ).expect(200);
      expect(updated.body).toMatchObject({
        id,
        key: 'e2e-key',
        value: 'changed',
      });

      await authed(
        request(app.getHttpServer()).delete(`/api/v1/purge/${id}`),
        accessToken,
      ).expect(204);

      const afterDelete = await authed(
        request(app.getHttpServer()).get('/api/v1/purge'),
        accessToken,
      ).expect(200);
      expect(
        afterDelete.body.find((e: { id: number }) => e.id === id),
      ).toBeUndefined();
    });

    it('rejects a duplicate key for the same user', async () => {
      const { accessToken } = await authenticatedUser();

      await authed(
        request(app.getHttpServer())
          .post('/api/v1/purge')
          .send({ key: 'dup', value: 'a' }),
        accessToken,
      ).expect(201);

      await authed(
        request(app.getHttpServer())
          .post('/api/v1/purge')
          .send({ key: 'dup', value: 'b' }),
        accessToken,
      ).expect(400);
    });

    it('rejects a duplicate value for the same user', async () => {
      const { accessToken } = await authenticatedUser();

      await authed(
        request(app.getHttpServer())
          .post('/api/v1/purge')
          .send({ key: 'a', value: 'dup' }),
        accessToken,
      ).expect(201);

      await authed(
        request(app.getHttpServer())
          .post('/api/v1/purge')
          .send({ key: 'b', value: 'dup' }),
        accessToken,
      ).expect(400);
    });

    // The ntlstl/purge desktop app's export format allows an entry with an
    // empty value; our schema requires one. This is the backend half of
    // that gap — the frontend import loop treats a rejection here as a
    // per-entry skip rather than failing the whole import.
    it('rejects an entry with an empty value', async () => {
      const { accessToken } = await authenticatedUser();

      await authed(
        request(app.getHttpServer())
          .post('/api/v1/purge')
          .send({ key: 'k', value: '' }),
        accessToken,
      ).expect(400);
    });

    it('404s when updating or deleting an entry that does not exist', async () => {
      const { accessToken } = await authenticatedUser();

      await authed(
        request(app.getHttpServer())
          .patch('/api/v1/purge/999999')
          .send({ value: 'x' }),
        accessToken,
      ).expect(404);

      await authed(
        request(app.getHttpServer()).delete('/api/v1/purge/999999'),
        accessToken,
      ).expect(404);
    });

    it('scopes entries per user — two users can each use the same key/value', async () => {
      const userA = await authenticatedUser();
      const userB = await authenticatedUser();

      await authed(
        request(app.getHttpServer())
          .post('/api/v1/purge')
          .send({ key: 'shared-key', value: 'shared-value' }),
        userA.accessToken,
      ).expect(201);

      await authed(
        request(app.getHttpServer())
          .post('/api/v1/purge')
          .send({ key: 'shared-key', value: 'shared-value' }),
        userB.accessToken,
      ).expect(201);

      const listB = await authed(
        request(app.getHttpServer()).get('/api/v1/purge'),
        userB.accessToken,
      ).expect(200);
      expect(listB.body).toHaveLength(1);
    });

    describe('/api/v1/purge/draft/text', () => {
      it('starts empty and round-trips a saved draft', async () => {
        const { accessToken } = await authenticatedUser();

        const initial = await authed(
          request(app.getHttpServer()).get('/api/v1/purge/draft/text'),
          accessToken,
        ).expect(200);
        expect(initial.body).toEqual({ text: '' });

        await authed(
          request(app.getHttpServer())
            .put('/api/v1/purge/draft/text')
            .send({ text: 'hello draft' }),
          accessToken,
        ).expect(200);

        const after = await authed(
          request(app.getHttpServer()).get('/api/v1/purge/draft/text'),
          accessToken,
        ).expect(200);
        expect(after.body).toEqual({ text: 'hello draft' });
      });
    });
  });
});
