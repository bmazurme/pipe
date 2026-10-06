import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { SessionsService } from '../src/auth/sessions.service';
import { UsersService } from '../src/users/users.service';

// Same ntlstl-db-test database as app.e2e-spec.ts (Purge) — see its own
// comment for why.
describe('Secrets API (e2e)', () => {
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

  describe('/api/v1/secrets', () => {
    it('rejects requests without a bearer token', () => {
      return request(app.getHttpServer()).get('/api/v1/secrets').expect(401);
    });

    it('supports the full create/list/reveal/update/delete lifecycle', async () => {
      const { accessToken } = await authenticatedUser();

      const created = await authed(
        request(app.getHttpServer()).post('/api/v1/secrets').send({
          name: 'e2e-secret',
          value: 'e2e-value',
          description: 'for the e2e suite',
        }),
        accessToken,
      ).expect(201);
      expect(created.body).toMatchObject({
        name: 'e2e-secret',
        description: 'for the e2e suite',
      });
      expect(created.body.value).toBeUndefined();
      const id = created.body.id;

      const list = await authed(
        request(app.getHttpServer()).get('/api/v1/secrets'),
        accessToken,
      ).expect(200);
      expect(list.body).toContainEqual(created.body);
      expect(
        list.body.every(
          (entry: Record<string, unknown>) => entry.value === undefined,
        ),
      ).toBe(true);

      const revealed = await authed(
        request(app.getHttpServer()).get(`/api/v1/secrets/${id}/value`),
        accessToken,
      ).expect(200);
      expect(revealed.body).toEqual({ value: 'e2e-value' });

      const updated = await authed(
        request(app.getHttpServer())
          .patch(`/api/v1/secrets/${id}`)
          .send({ value: 'changed-value' }),
        accessToken,
      ).expect(200);
      expect(updated.body).toMatchObject({ id, name: 'e2e-secret' });

      const revealedAfterUpdate = await authed(
        request(app.getHttpServer()).get(`/api/v1/secrets/${id}/value`),
        accessToken,
      ).expect(200);
      expect(revealedAfterUpdate.body).toEqual({ value: 'changed-value' });

      await authed(
        request(app.getHttpServer()).delete(`/api/v1/secrets/${id}`),
        accessToken,
      ).expect(204);

      const afterDelete = await authed(
        request(app.getHttpServer()).get('/api/v1/secrets'),
        accessToken,
      ).expect(200);
      expect(
        afterDelete.body.find((e: { id: number }) => e.id === id),
      ).toBeUndefined();
    });

    it('rejects a duplicate name for the same user', async () => {
      const { accessToken } = await authenticatedUser();

      await authed(
        request(app.getHttpServer())
          .post('/api/v1/secrets')
          .send({ name: 'dup', value: 'a' }),
        accessToken,
      ).expect(201);

      await authed(
        request(app.getHttpServer())
          .post('/api/v1/secrets')
          .send({ name: 'dup', value: 'b' }),
        accessToken,
      ).expect(400);
    });

    it('allows the same name across two different users', async () => {
      const userA = await authenticatedUser();
      const userB = await authenticatedUser();

      await authed(
        request(app.getHttpServer())
          .post('/api/v1/secrets')
          .send({ name: 'shared-name', value: 'a' }),
        userA.accessToken,
      ).expect(201);

      await authed(
        request(app.getHttpServer())
          .post('/api/v1/secrets')
          .send({ name: 'shared-name', value: 'b' }),
        userB.accessToken,
      ).expect(201);
    });

    it('never lets one user reveal, update or delete another user’s secret', async () => {
      const owner = await authenticatedUser();
      const other = await authenticatedUser();

      const created = await authed(
        request(app.getHttpServer())
          .post('/api/v1/secrets')
          .send({ name: 'owners-secret', value: 'owners-value' }),
        owner.accessToken,
      ).expect(201);
      const id = created.body.id;

      await authed(
        request(app.getHttpServer()).get(`/api/v1/secrets/${id}/value`),
        other.accessToken,
      ).expect(404);

      await authed(
        request(app.getHttpServer())
          .patch(`/api/v1/secrets/${id}`)
          .send({ value: 'hijacked' }),
        other.accessToken,
      ).expect(404);

      await authed(
        request(app.getHttpServer()).delete(`/api/v1/secrets/${id}`),
        other.accessToken,
      ).expect(404);

      const stillThere = await authed(
        request(app.getHttpServer()).get(`/api/v1/secrets/${id}/value`),
        owner.accessToken,
      ).expect(200);
      expect(stillThere.body).toEqual({ value: 'owners-value' });
    });

    it('404s when updating, deleting or revealing a secret that does not exist', async () => {
      const { accessToken } = await authenticatedUser();

      await authed(
        request(app.getHttpServer())
          .patch('/api/v1/secrets/999999')
          .send({ value: 'x' }),
        accessToken,
      ).expect(404);

      await authed(
        request(app.getHttpServer()).delete('/api/v1/secrets/999999'),
        accessToken,
      ).expect(404);

      await authed(
        request(app.getHttpServer()).get('/api/v1/secrets/999999/value'),
        accessToken,
      ).expect(404);
    });
  });
});
