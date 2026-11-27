import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { SessionsService } from '../src/auth/sessions.service';
import { totpAt } from '../src/auth/step-up/totp';
import { UsersService } from '../src/users/users.service';

// The second factor for dangerous actions (S6), against the real guards and database — the unit tests cover the
// service and the guard apart; this checks they meet in the right order on real routes.
describe('Step-up confirmation (e2e)', () => {
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

  // Turns two-factor on for a fresh user; returns what the tests need.
  async function enrolled() {
    const user = await authenticatedUser();
    const setup = await authed(
      http().post('/api/v1/auth/2fa/setup'),
      user.accessToken,
    ).expect(201);
    const enable = await authed(
      http()
        .post('/api/v1/auth/2fa/enable')
        .send({ code: totpAt(setup.body.secret, Date.now()) }),
      user.accessToken,
    ).expect(200);

    return {
      ...user,
      secret: setup.body.secret as string,
      recoveryCodes: enable.body.recoveryCodes as string[],
    };
  }

  // The next 30-second step: the one used to enable is spent, and the window accepts one step ahead.
  const nextCode = (secret: string) => totpAt(secret, Date.now() + 30_000);

  async function grant(user: {
    accessToken: string;
    secret: string;
  }): Promise<string> {
    const res = await authed(
      http()
        .post('/api/v1/auth/2fa/verify')
        .send({ code: nextCode(user.secret) }),
      user.accessToken,
    ).expect(200);

    return res.body.token;
  }

  async function createSecret(token: string): Promise<number> {
    const created = await authed(
      http()
        .post('/api/v1/secrets')
        .send({ name: `e2e_${Date.now()}`, value: 'e2e-value' }),
      token,
    ).expect(201);

    return created.body.id;
  }

  beforeAll(async () => {
    process.env.POSTGRES_DB = 'ntlstl-db-test';

    // The routes' own throttle is per address and every request here comes from one, so a file that enrols a dozen
    // users would trip it. Switched off for this file (throttling.e2e-spec covers the throttle itself); the account
    // lock inside the service is what the lock test exercises.
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

  it('leaves a dangerous route open while two-factor is not set up', async () => {
    const { accessToken } = await authenticatedUser();
    const id = await createSecret(accessToken);

    await authed(http().get(`/api/v1/secrets/${id}/value`), accessToken).expect(
      200,
    );
  });

  it('reports the state, and never exposes the secret in it', async () => {
    const user = await enrolled();
    const status = await authed(
      http().get('/api/v1/auth/2fa'),
      user.accessToken,
    ).expect(200);

    expect(status.body).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });
    expect(JSON.stringify(status.body)).not.toContain(user.secret);
  });

  it('refuses a wrong first code and stays off', async () => {
    const { accessToken } = await authenticatedUser();

    await authed(http().post('/api/v1/auth/2fa/setup'), accessToken).expect(
      201,
    );
    await authed(
      http().post('/api/v1/auth/2fa/enable').send({ code: '000000' }),
      accessToken,
    ).expect(403);

    const status = await authed(
      http().get('/api/v1/auth/2fa'),
      accessToken,
    ).expect(200);

    expect(status.body).toMatchObject({ enabled: false, setupPending: true });
  });

  it('asks for the code on reveal, then lets a grant through', async () => {
    const user = await enrolled();
    const id = await createSecret(user.accessToken);

    const refused = await authed(
      http().get(`/api/v1/secrets/${id}/value`),
      user.accessToken,
    ).expect(403);

    expect(refused.body.code).toBe('STEP_UP_REQUIRED');

    const token = await grant(user);
    const revealed = await authed(
      http().get(`/api/v1/secrets/${id}/value`).set('X-Step-Up', token),
      user.accessToken,
    ).expect(200);

    expect(revealed.body.value).toBe('e2e-value');
  });

  it('guards the .env export and deleting a secret the same way', async () => {
    const user = await enrolled();
    const id = await createSecret(user.accessToken);
    const token = await grant(user);

    await authed(http().get('/api/v1/secrets/export'), user.accessToken).expect(
      403,
    );
    await authed(
      http().delete(`/api/v1/secrets/${id}`),
      user.accessToken,
    ).expect(403);
    await authed(
      http().get('/api/v1/secrets/export').set('X-Step-Up', token),
      user.accessToken,
    ).expect(200);
    await authed(
      http().delete(`/api/v1/secrets/${id}`).set('X-Step-Up', token),
      user.accessToken,
    ).expect(204);
  });

  it('guards key issue and revoke where the session guard sits on the method', async () => {
    const user = await enrolled();

    const refused = await authed(
      http().post('/api/v1/auth/api-keys').send({ name: 'e2e-key' }),
      user.accessToken,
    ).expect(403);

    expect(refused.body.code).toBe('STEP_UP_REQUIRED');

    const token = await grant(user);
    const created = await authed(
      http()
        .post('/api/v1/auth/api-keys')
        .set('X-Step-Up', token)
        .send({ name: 'e2e-key' }),
      user.accessToken,
    ).expect(201);

    await authed(
      http().delete(`/api/v1/auth/api-keys/${created.body.id}`),
      user.accessToken,
    ).expect(403);
    await authed(
      http()
        .delete(`/api/v1/auth/api-keys/${created.body.id}`)
        .set('X-Step-Up', token),
      user.accessToken,
    ).expect(200);
  });

  it('answers 403, not 401, on the guarded worker routes (the session guard still runs first)', async () => {
    const user = await enrolled();
    const res = await authed(
      http().post('/api/v1/workers').send({ name: 'e2e-worker' }),
      user.accessToken,
    );

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('STEP_UP_REQUIRED');
    await http()
      .post('/api/v1/workers')
      .send({ name: 'e2e-worker' })
      .expect(401);
  });

  it("does not take another user's grant, nor a login token in its place", async () => {
    const a = await enrolled();
    const b = await enrolled();
    const id = await createSecret(b.accessToken);
    const grantOfA = await grant(a);

    await authed(
      http().get(`/api/v1/secrets/${id}/value`).set('X-Step-Up', grantOfA),
      b.accessToken,
    ).expect(403);
    await authed(
      http().get(`/api/v1/secrets/${id}/value`).set('X-Step-Up', b.accessToken),
      b.accessToken,
    ).expect(403);
  });

  it('does not accept a step-up grant as a login token', async () => {
    const user = await enrolled();
    const token = await grant(user);

    await http()
      .get('/api/v1/secrets')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('refuses the same code twice', async () => {
    const user = await enrolled();
    const code = nextCode(user.secret);

    await authed(
      http().post('/api/v1/auth/2fa/verify').send({ code }),
      user.accessToken,
    ).expect(200);
    await authed(
      http().post('/api/v1/auth/2fa/verify').send({ code }),
      user.accessToken,
    ).expect(403);
  });

  it('takes a recovery code once', async () => {
    const user = await enrolled();
    const [code] = user.recoveryCodes;

    await authed(
      http().post('/api/v1/auth/2fa/verify').send({ code }),
      user.accessToken,
    ).expect(200);
    await authed(
      http().post('/api/v1/auth/2fa/verify').send({ code }),
      user.accessToken,
    ).expect(403);
  });

  it('locks after repeated wrong codes', async () => {
    const user = await enrolled();

    for (let i = 0; i < 5; i++) {
      await authed(
        http().post('/api/v1/auth/2fa/verify').send({ code: '000000' }),
        user.accessToken,
      );
    }

    const res = await authed(
      http()
        .post('/api/v1/auth/2fa/verify')
        .send({ code: nextCode(user.secret) }),
      user.accessToken,
    );

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('STEP_UP_LOCKED');
  });

  it('turns off only with a valid code, after which the routes open again', async () => {
    const user = await enrolled();
    const id = await createSecret(user.accessToken);

    await authed(
      http().post('/api/v1/auth/2fa/disable').send({ code: '000000' }),
      user.accessToken,
    ).expect(403);
    await authed(
      http()
        .post('/api/v1/auth/2fa/disable')
        .send({ code: nextCode(user.secret) }),
      user.accessToken,
    ).expect(204);
    await authed(
      http().get(`/api/v1/secrets/${id}/value`),
      user.accessToken,
    ).expect(200);
  });

  it('still lets a machine key use a shared route (Storage delete) without a code', async () => {
    const user = await enrolled();
    const token = await grant(user);
    const key = await authed(
      http()
        .post('/api/v1/auth/api-keys')
        .set('X-Step-Up', token)
        .send({ name: 'machine' }),
      user.accessToken,
    ).expect(201);
    const res = await http()
      .delete('/api/v1/storage/999999')
      .set('X-Api-Key', key.body.key ?? key.body.token);

    // 404 (no such file) — not 403 STEP_UP_REQUIRED.
    expect(res.status).toBe(404);
  });
});
