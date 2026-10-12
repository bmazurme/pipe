import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { IdentitiesService } from '../src/auth/identities.service';
import { SessionsService } from '../src/auth/sessions.service';
import { UsersService } from '../src/users/users.service';

// Same ntlstl-db-test database as the other e2e suites.
describe('Sign-in methods (e2e)', () => {
  let app: INestApplication<App>;

  async function userWith(...providers: ('yandex' | 'github')[]) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const user = await app
      .get(UsersService)
      .create({ email: `e2e-${suffix}@ntlstl.test` });

    for (const provider of providers) {
      await app
        .get(IdentitiesService)
        .create(user.id, provider, `${provider}-${suffix}`, user.email);
    }

    const session = await app
      .get(SessionsService)
      .createSession(user.id, 'jest', '127.0.0.1');
    const accessToken = app
      .get(JwtService)
      .sign({ sub: user.id, sessionId: session.id });

    return { userId: user.id, accessToken };
  }

  const authed = (req: request.Test, token: string) =>
    req.set('Authorization', `Bearer ${token}`);

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

  it('requires a browser session', () =>
    request(app.getHttpServer()).get('/api/v1/auth/identities').expect(401));

  it('lists the methods of the current user only', async () => {
    const { accessToken } = await userWith('yandex', 'github');
    await userWith('yandex');

    const { body } = await authed(
      request(app.getHttpServer()).get('/api/v1/auth/identities'),
      accessToken,
    ).expect(200);

    expect(body.map((i: { provider: string }) => i.provider)).toEqual([
      'yandex',
      'github',
    ]);
  });

  it('keeps at least one method enabled: the last one cannot be disabled or unlinked', async () => {
    const { accessToken } = await userWith('yandex', 'github');
    const server = app.getHttpServer();

    await authed(
      request(server).post('/api/v1/auth/identities/github/disable'),
      accessToken,
    ).expect(204);
    await authed(
      request(server).post('/api/v1/auth/identities/yandex/disable'),
      accessToken,
    ).expect(409);
    await authed(
      request(server).delete('/api/v1/auth/identities/yandex'),
      accessToken,
    ).expect(409);

    // a disabled method can be re-enabled, and then the other one can go
    await authed(
      request(server).post('/api/v1/auth/identities/github/enable'),
      accessToken,
    ).expect(204);
    await authed(
      request(server).post('/api/v1/auth/identities/yandex/disable'),
      accessToken,
    ).expect(204);
  });

  it('two simultaneous disables cannot leave the account without a method', async () => {
    const { accessToken } = await userWith('yandex', 'github');
    const server = app.getHttpServer();

    const results = await Promise.all(
      ['yandex', 'github'].map((provider) =>
        authed(
          request(server).post(`/api/v1/auth/identities/${provider}/disable`),
          accessToken,
        ),
      ),
    );

    expect(results.map((r) => r.status).sort()).toEqual([204, 409]);

    const { body } = await authed(
      request(server).get('/api/v1/auth/identities'),
      accessToken,
    );
    expect(body.filter((i: { enabled: boolean }) => i.enabled)).toHaveLength(1);
  });

  it('rejects an unknown provider', async () => {
    const { accessToken } = await userWith('yandex');

    await authed(
      request(app.getHttpServer()).post(
        '/api/v1/auth/identities/gitlab/disable',
      ),
      accessToken,
    ).expect(400);
  });

  it('starts a link only for a signed-in user and sets the nonce cookie', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/oauth/github/link')
      .expect(401);

    const { accessToken } = await userWith('yandex');
    const res = await authed(
      request(app.getHttpServer()).post('/api/v1/oauth/github/link'),
      accessToken,
    ).expect(200);

    expect(typeof res.body.state).toBe('string');
    expect(String(res.headers['set-cookie'])).toContain('oauth_link_nonce=');
  });
});
