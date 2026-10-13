import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { SessionsService } from '../src/auth/sessions.service';
import { TelegramService } from '../src/telegram/telegram.service';
import { UsersService } from '../src/users/users.service';

// Same ntlstl-db-test database as the other e2e files. The emergency key is the way in when neither Yandex nor
// GitHub works (docs/ha-dr-plan.md §7.5): these tests walk the whole path through the real app and database.
describe('Emergency key (e2e)', () => {
  let app: INestApplication<App>;
  const telegramSend = jest.fn().mockResolvedValue(true);

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

  const authed = (req: request.Test, token: string) =>
    req.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    process.env.POSTGRES_DB = 'ntlstl-db-test';

    // never a real message: the use of the key is announced to Telegram, and a developer's .env has the real bot
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(TelegramService)
      .useValue({
        send: telegramSend,
        isConfigured: () => false,
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

  it('is behind a session: create, status and revoke reject anonymous callers', async () => {
    const server = app.getHttpServer();

    await request(server).get('/api/v1/auth/emergency-key').expect(401);
    await request(server).post('/api/v1/auth/emergency-key').expect(401);
    await request(server).delete('/api/v1/auth/emergency-key').expect(401);
  });

  it('creates a key, shows it once, and the key signs in as that user', async () => {
    const server = app.getHttpServer();
    const { accessToken, userId } = await authenticatedUser();

    const none = await authed(
      request(server).get('/api/v1/auth/emergency-key'),
      accessToken,
    ).expect(200);

    expect((none.body as { exists: boolean }).exists).toBe(false);

    const created = await authed(
      request(server).post('/api/v1/auth/emergency-key'),
      accessToken,
    ).expect(201);
    const { token, prefix } = created.body as {
      token: string;
      prefix: string;
    };

    expect(token.startsWith('bre_')).toBe(true);
    expect(prefix).toBe(token.slice(0, 12));

    // the status never carries the secret
    const status = await authed(
      request(server).get('/api/v1/auth/emergency-key'),
      accessToken,
    ).expect(200);

    expect(status.body).toMatchObject({ exists: true, prefix });
    expect(JSON.stringify(status.body)).not.toContain(token);

    // the key opens a browser session: a refresh cookie, and /auth/check then gives an access token
    const login = await request(server)
      .post('/api/v1/auth/emergency-login')
      .send({ key: token })
      .expect(200);
    const cookies = login.headers['set-cookie'] as unknown as string[];
    const refresh = cookies.find((c) => c.startsWith('bridgeRefreshToken='));

    expect(refresh).toBeDefined();

    const check = await request(server)
      .get('/api/v1/auth/check')
      .set('Cookie', (refresh as string).split(';')[0])
      .expect(200);

    expect(check.body).toMatchObject({ isAuthenticated: true });
    expect((check.body as { accessToken?: string }).accessToken).toBeDefined();

    const used = await authed(
      request(server).get('/api/v1/auth/emergency-key'),
      accessToken,
    ).expect(200);

    expect(
      (used.body as { lastUsedAt: string | null }).lastUsedAt,
    ).not.toBeNull();
    expect(userId).toBeGreaterThan(0);
    // the use was announced (to the stub, not to a real chat)
    expect(telegramSend).toHaveBeenCalledWith(
      expect.stringContaining('аварийному ключу'),
    );
  });

  it('refuses a wrong key without a cookie, and an API key is not an emergency key', async () => {
    const server = app.getHttpServer();

    const wrong = await request(server)
      .post('/api/v1/auth/emergency-login')
      .send({ key: `bre_${'x'.repeat(43)}` })
      .expect(401);

    expect(wrong.headers['set-cookie']).toBeUndefined();

    await request(server)
      .post('/api/v1/auth/emergency-login')
      .send({ key: `brk_${'x'.repeat(32)}` })
      .expect(401);
  });

  it('is not an API key: the emergency token does not open machine routes', async () => {
    const server = app.getHttpServer();
    const { accessToken } = await authenticatedUser();
    const created = await authed(
      request(server).post('/api/v1/auth/emergency-key'),
      accessToken,
    ).expect(201);
    const { token } = created.body as { token: string };

    await request(server)
      .get('/api/v1/worker/status')
      .set('X-Api-Key', token)
      .expect(401);
  });

  it('a new key replaces the old one, and a revoked key no longer signs in', async () => {
    const server = app.getHttpServer();
    const { accessToken } = await authenticatedUser();

    const first = await authed(
      request(server).post('/api/v1/auth/emergency-key'),
      accessToken,
    ).expect(201);
    const second = await authed(
      request(server).post('/api/v1/auth/emergency-key'),
      accessToken,
    ).expect(201);
    const oldToken = (first.body as { token: string }).token;
    const newToken = (second.body as { token: string }).token;

    expect(newToken).not.toBe(oldToken);

    await request(server)
      .post('/api/v1/auth/emergency-login')
      .send({ key: oldToken })
      .expect(401);

    await authed(
      request(server).delete('/api/v1/auth/emergency-key'),
      accessToken,
    ).expect(204);
    await authed(
      request(server).delete('/api/v1/auth/emergency-key'),
      accessToken,
    ).expect(404);
    await request(server)
      .post('/api/v1/auth/emergency-login')
      .send({ key: newToken })
      .expect(401);
  });
});
