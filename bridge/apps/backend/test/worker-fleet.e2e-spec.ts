import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { ApiKeysService } from '../src/auth/api-keys.service';
import { SessionsService } from '../src/auth/sessions.service';
import { StorageService } from '../src/storage/storage.service';
import { TelegramService } from '../src/telegram/telegram.service';
import { UsersService } from '../src/users/users.service';

// Workers added in the UI: enrolled with a one-time code (no secret in their environment), authenticated with their
// own scoped key, configured from the page, given work that is pinned to them or free for any, and deletable.
// Real app, real database.
describe('Worker fleet (e2e)', () => {
  let app: INestApplication<App>;
  const server = () => app.getHttpServer();

  async function owner() {
    const user = await app.get(UsersService).create({
      email: `fleet-${Date.now()}-${Math.random().toString(36).slice(2)}@ntlstl.test`,
    });
    const session = await app
      .get(SessionsService)
      .createSession(user.id, 'jest', '127.0.0.1');
    const accessToken = app
      .get(JwtService)
      .sign({ sub: user.id, sessionId: session.id });

    return { userId: user.id, accessToken };
  }

  const as = (req: request.Test, token: string) =>
    req.set('Authorization', `Bearer ${token}`);

  async function addWorker(
    token: string,
    name: string,
    settings: Record<string, unknown> = {},
  ) {
    const created = await as(request(server()).post('/api/v1/workers'), token)
      .send({ name, ...settings })
      .expect(201);

    return created.body as {
      worker: { id: number; state: string };
      enrollCode: string;
    };
  }

  let nextAddress = 1;

  async function enroll(code: string) {
    const res = await request(server())
      .post('/api/v1/workers/enroll')
      .set('X-Forwarded-For', `10.1.0.${nextAddress++}`)
      .send({ code, hostname: 'box', version: '1.0.0' })
      .expect(200);

    return res.body as { workerId: number; name: string; key: string };
  }

  async function job(userId: number, token: string, extra = {}) {
    const file = await app
      .get(StorageService)
      .createFromBuffer(
        userId,
        Buffer.from('parcel'),
        `p-${Math.random()}.zip`,
      );
    const created = await as(
      request(server()).post('/api/v1/worker/jobs'),
      token,
    )
      .send({ sourceFileId: file.id, model: 'sonnet', ...extra })
      .expect(201);

    return created.body as { id: number; targetWorkerId: number | null };
  }

  beforeAll(async () => {
    process.env.POSTGRES_DB = 'ntlstl-db-test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(TelegramService)
      .useValue({
        send: jest.fn().mockResolvedValue(true),
        isConfigured: () => false,
      })
      .compile();

    app = moduleFixture.createNestApplication();
    // the enrollment route is limited to 10 tries a minute per address; this suite enrols more workers than that,
    // so each enrolment comes from its own (forwarded) address
    (
      app.getHttpAdapter().getInstance() as {
        set: (k: string, v: unknown) => void;
      }
    ).set('trust proxy', true);
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('adding and connecting a worker', () => {
    it('is behind a browser session', async () => {
      await request(server()).get('/api/v1/workers').expect(401);
      await request(server())
        .post('/api/v1/workers')
        .send({ name: 'x' })
        .expect(401);
    });

    it('a new worker is pending until it redeems its one-time code, then it holds its own key', async () => {
      const { accessToken } = await owner();
      const { worker, enrollCode } = await addWorker(accessToken, 'green');

      expect(worker.state).toBe('pending');
      expect(enrollCode.startsWith('brn_')).toBe(true);

      // the listing never carries the code or a key
      const listed = await as(
        request(server()).get('/api/v1/workers'),
        accessToken,
      ).expect(200);

      expect(JSON.stringify(listed.body)).not.toContain(enrollCode);
      expect(listed.body).toHaveLength(1);

      const enrolled = await enroll(enrollCode);

      expect(enrolled).toMatchObject({ workerId: worker.id, name: 'green' });
      expect(enrolled.key.startsWith('brw_')).toBe(true);

      const after = await as(
        request(server()).get('/api/v1/workers'),
        accessToken,
      ).expect(200);

      expect(after.body[0]).toMatchObject({
        id: worker.id,
        state: 'idle',
        hostname: 'box',
        version: '1.0.0',
        kind: 'managed',
      });
    });

    it('the code is single-use, and a wrong one is refused', async () => {
      const { accessToken } = await owner();
      const { enrollCode } = await addWorker(accessToken, 'once');

      await enroll(enrollCode);
      await request(server())
        .post('/api/v1/workers/enroll')
        .send({ code: enrollCode })
        .expect(401);
      await request(server())
        .post('/api/v1/workers/enroll')
        .send({ code: 'brn_not-a-real-code' })
        .expect(401);
    });

    it('two workers of one account cannot share a name', async () => {
      const { accessToken } = await owner();

      await addWorker(accessToken, 'same');
      await as(request(server()).post('/api/v1/workers'), accessToken)
        .send({ name: 'same' })
        .expect(409);
    });

    it('refuses a malformed setting', async () => {
      const { accessToken } = await owner();

      await as(request(server()).post('/api/v1/workers'), accessToken)
        .send({ name: 'bad', proxyUrl: 'socks5://x' })
        .expect(400);
      await as(request(server()).post('/api/v1/workers'), accessToken)
        .send({ name: 'bad', models: ['gpt-9'] })
        .expect(400);
      await as(request(server()).post('/api/v1/workers'), accessToken)
        .send({ name: 'bad', jobTimeoutSec: 5 })
        .expect(400);
    });

    it('renewing the code connects it again and revokes the old key', async () => {
      const { accessToken } = await owner();
      const { worker, enrollCode } = await addWorker(accessToken, 'again');
      const { key } = await enroll(enrollCode);

      await request(server())
        .get('/api/v1/workers/me/config')
        .set('Authorization', `Bearer ${key}`)
        .expect(200);

      const renewed = await as(
        request(server()).post(`/api/v1/workers/${worker.id}/enroll-code`),
        accessToken,
      ).expect(201);

      await request(server())
        .get('/api/v1/workers/me/config')
        .set('Authorization', `Bearer ${key}`)
        .expect(401);

      const second = await enroll(
        (renewed.body as { enrollCode: string }).enrollCode,
      );

      await request(server())
        .get('/api/v1/workers/me/config')
        .set('Authorization', `Bearer ${second.key}`)
        .expect(200);
    });
  });

  describe('a worker key is scoped', () => {
    it('fetches its own settings, and only with its own key', async () => {
      const { accessToken, userId } = await owner();
      const { enrollCode } = await addWorker(accessToken, 'cfg', {
        models: ['gpt'],
        jobTimeoutSec: 600,
        proxyUrl: 'http://proxy:1080',
        chatEnabled: false,
      });
      const { key } = await enroll(enrollCode);

      const config = await request(server())
        .get('/api/v1/workers/me/config')
        .set('Authorization', `Bearer ${key}`)
        .expect(200);

      expect(config.body).toMatchObject({
        name: 'cfg',
        enabled: true,
        models: ['gpt'],
        jobTimeoutSec: 600,
        proxyUrl: 'http://proxy:1080',
        chatEnabled: false,
        pollIntervalSec: 10,
      });

      // a personal API key is no worker
      const apiKey = await app.get(ApiKeysService).create(userId, 'k');

      await request(server())
        .get('/api/v1/workers/me/config')
        .set('Authorization', `Bearer ${apiKey.token}`)
        .expect(401);
    });

    it('cannot call anything a worker does not need', async () => {
      const { accessToken } = await owner();
      const { enrollCode } = await addWorker(accessToken, 'narrow');
      const { key } = await enroll(enrollCode);
      const withKey = (req: request.Test) =>
        req.set('Authorization', `Bearer ${key}`);

      await withKey(request(server()).get('/api/v1/worker/jobs')).expect(403);
      await withKey(request(server()).get('/api/v1/storage')).expect(403);
      // browser-session routes do not even see a worker key as a session
      await withKey(request(server()).get('/api/v1/secrets')).expect(401);
      // management of the fleet is browser-only
      await withKey(request(server()).get('/api/v1/workers')).expect(401);
      await withKey(
        request(server()).post('/api/v1/workers').send({ name: 'sneaky' }),
      ).expect(401);
    });
  });

  describe('who gets which job', () => {
    it('a free worker takes the oldest job; while it holds one it is given nothing more', async () => {
      const { accessToken, userId } = await owner();
      const { enrollCode } = await addWorker(accessToken, 'solo');
      const { key } = await enroll(enrollCode);
      const first = await job(userId, accessToken);

      await job(userId, accessToken);

      const claim = (token: string) =>
        request(server())
          .post('/api/v1/worker/jobs/claim')
          .set('Authorization', `Bearer ${token}`)
          .send({});

      const taken = await claim(key).expect(200);

      expect(taken.body).toMatchObject({ id: first.id, status: 'claimed' });
      expect(taken.body.workerName).toBe('solo');
      expect(taken.body.provider).toBeNull();
    });

    it('a job pinned to one worker is taken by that worker and by no other', async () => {
      const { accessToken, userId } = await owner();
      const a = await enroll((await addWorker(accessToken, 'a')).enrollCode);
      const bWorker = await addWorker(accessToken, 'b');
      const b = await enroll(bWorker.enrollCode);
      const pinned = await job(userId, accessToken, {
        targetWorkerId: bWorker.worker.id,
      });

      expect(pinned.targetWorkerId).toBe(bWorker.worker.id);

      const claim = (token: string) =>
        request(server())
          .post('/api/v1/worker/jobs/claim')
          .set('Authorization', `Bearer ${token}`)
          .send({});

      await claim(a.key).expect(204);

      const apiKey = await app.get(ApiKeysService).create(userId, 'legacy');

      // a legacy worker (personal API key) never takes a pinned job either
      await claim(apiKey.token).expect(204);

      const taken = await claim(b.key).expect(200);

      expect(taken.body).toMatchObject({ id: pinned.id });
    });

    it('a paused worker gets nothing; resuming gives it work again', async () => {
      const { accessToken, userId } = await owner();
      const w = await addWorker(accessToken, 'napper');
      const { key } = await enroll(w.enrollCode);

      await job(userId, accessToken);
      await as(
        request(server()).patch(`/api/v1/workers/${w.worker.id}`),
        accessToken,
      )
        .send({ enabled: false })
        .expect(200);

      const claim = () =>
        request(server())
          .post('/api/v1/worker/jobs/claim')
          .set('Authorization', `Bearer ${key}`)
          .send({});

      await claim().expect(204);

      await as(
        request(server()).patch(`/api/v1/workers/${w.worker.id}`),
        accessToken,
      )
        .send({ enabled: true })
        .expect(200);
      await claim().expect(200);
    });

    it('a worker restricted to some models only takes those', async () => {
      const { accessToken, userId } = await owner();
      const w = await addWorker(accessToken, 'gpt-only', { models: ['gpt'] });
      const { key } = await enroll(w.enrollCode);

      await job(userId, accessToken, { model: 'sonnet' });

      await request(server())
        .post('/api/v1/worker/jobs/claim')
        .set('Authorization', `Bearer ${key}`)
        .send({})
        .expect(204);
    });

    it('refuses to pin a job to a paused worker or to one that cannot run the model', async () => {
      const { accessToken, userId } = await owner();
      const paused = await addWorker(accessToken, 'paused');

      await as(
        request(server()).patch(`/api/v1/workers/${paused.worker.id}`),
        accessToken,
      )
        .send({ enabled: false })
        .expect(200);

      const file = await app
        .get(StorageService)
        .createFromBuffer(userId, Buffer.from('p'), 'p.zip');

      await as(request(server()).post('/api/v1/worker/jobs'), accessToken)
        .send({
          sourceFileId: file.id,
          model: 'sonnet',
          targetWorkerId: paused.worker.id,
        })
        .expect(400);

      const limited = await addWorker(accessToken, 'limited', {
        models: ['gpt'],
      });

      await as(request(server()).post('/api/v1/worker/jobs'), accessToken)
        .send({
          sourceFileId: file.id,
          model: 'opus',
          targetWorkerId: limited.worker.id,
        })
        .expect(400);
    });

    it('a worker only reports on the job it holds', async () => {
      const { accessToken, userId } = await owner();
      const a = await enroll(
        (await addWorker(accessToken, 'holder')).enrollCode,
      );
      const b = await enroll(
        (await addWorker(accessToken, 'other')).enrollCode,
      );
      const created = await job(userId, accessToken);
      const claimed = await request(server())
        .post('/api/v1/worker/jobs/claim')
        .set('Authorization', `Bearer ${a.key}`)
        .send({})
        .expect(200);

      expect(claimed.body.id).toBe(created.id);

      const status = (token: string) =>
        request(server())
          .post(`/api/v1/worker/jobs/${created.id}/status`)
          .set('Authorization', `Bearer ${token}`)
          .send({ status: 'running' });

      await status(b.key).expect(403);
      await status(a.key).expect(201);
      await request(server())
        .post(`/api/v1/worker/jobs/${created.id}/logs`)
        .set('Authorization', `Bearer ${b.key}`)
        .send({ chunk: 'hijack' })
        .expect(403);
    });
  });

  describe('the Claude token a worker runs with', () => {
    const newToken = async (accessToken: string, name: string, token: string) =>
      (
        await as(
          request(server()).post('/api/v1/worker/claude-credentials'),
          accessToken,
        )
          .send({ name, token })
          .expect(201)
      ).body as { id: number };
    const claimToken = async (key: string) =>
      (
        await request(server())
          .post('/api/v1/worker/jobs/claim')
          .set('Authorization', `Bearer ${key}`)
          .send({})
          .expect(200)
      ).body.claudeToken as string | null;

    it('each worker uses the token set in its settings; a token picked for the job wins; unset = the first token', async () => {
      const { accessToken, userId } = await owner();
      const first = await newToken(accessToken, 'first', 'tok-first');
      const second = await newToken(accessToken, 'second', 'tok-second');
      const a = await addWorker(accessToken, 'bound-a', {
        claudeCredentialId: second.id,
      });
      const b = await addWorker(accessToken, 'unbound-b');
      const keyA = (await enroll(a.enrollCode)).key;
      const keyB = (await enroll(b.enrollCode)).key;

      await job(userId, accessToken, { targetWorkerId: a.worker.id });
      expect(await claimToken(keyA)).toBe('tok-second');

      await job(userId, accessToken, {
        targetWorkerId: a.worker.id,
        claudeCredentialId: first.id,
      });
      expect(await claimToken(keyA)).toBe('tok-first');

      await job(userId, accessToken, { targetWorkerId: b.worker.id });
      expect(await claimToken(keyB)).toBe('tok-first');
    });

    it('can be changed and cleared in the settings, and only to a token of the owner', async () => {
      const { accessToken } = await owner();
      const other = await owner();
      const mine = await newToken(accessToken, 'mine', 'tok-mine');
      const theirs = await newToken(other.accessToken, 'theirs', 'tok-theirs');
      const w = await addWorker(accessToken, 'settings');
      const patch = (body: object) =>
        as(
          request(server()).patch(`/api/v1/workers/${w.worker.id}`),
          accessToken,
        ).send(body);

      expect(
        (await patch({ claudeCredentialId: mine.id }).expect(200)).body
          .claudeCredentialId,
      ).toBe(mine.id);
      await patch({ claudeCredentialId: theirs.id }).expect(400);
      expect(
        (await patch({ claudeCredentialId: null }).expect(200)).body
          .claudeCredentialId,
      ).toBeNull();
    });
  });

  describe('refreshing the plan limits', () => {
    const limits = {
      status: 'allowed',
      rateLimitType: null,
      isUsingOverage: false,
      windows: { five_hour: { utilization: 0.31, resetsAt: 1900000000 } },
    };

    async function enrolled(name: string, extra: Record<string, unknown> = {}) {
      const { accessToken, userId } = await owner();
      const token = (
        await as(
          request(server()).post('/api/v1/worker/claude-credentials'),
          accessToken,
        )
          .send({ name: 'probe-token', token: 'tok-probe' })
          .expect(201)
      ).body as { id: number };
      const w = await addWorker(accessToken, name, extra);
      const { key } = await enroll(w.enrollCode);

      return { accessToken, userId, token, w, key };
    }

    const configOf = (key: string) =>
      request(server())
        .get('/api/v1/workers/me/config')
        .set('Authorization', `Bearer ${key}`)
        .expect(200);

    it('hands the worker the token to probe with only while a probe is due (asked for, or an interval is set)', async () => {
      const { accessToken, w, key } = await enrolled('probe-a');

      // nothing asked: no token in the settings
      expect((await configOf(key)).body.limitProbe).toBeNull();

      await as(
        request(server()).post(`/api/v1/workers/${w.worker.id}/refresh-limits`),
        accessToken,
      ).expect(204);

      const asked = (await configOf(key)).body;

      expect(asked.limitProbe).toEqual({ claudeToken: 'tok-probe' });
      expect(asked.limitsRefreshRequestedAt).toBeTruthy();

      // the owner's own views never carry a token
      const listed = await as(
        request(server()).get('/api/v1/workers'),
        accessToken,
      ).expect(200);

      expect(JSON.stringify(listed.body)).not.toContain('tok-probe');
    });

    it('also does it every time when an interval is chosen in the settings, which is validated', async () => {
      const { accessToken, w, key } = await enrolled('probe-b');
      const patch = (body: object) =>
        as(
          request(server()).patch(`/api/v1/workers/${w.worker.id}`),
          accessToken,
        ).send(body);

      await patch({ limitsRefreshMin: 7 }).expect(400);
      expect(
        (await patch({ limitsRefreshMin: 30 }).expect(200)).body
          .limitsRefreshMin,
      ).toBe(30);
      expect((await configOf(key)).body).toMatchObject({
        limitsRefreshMin: 30,
        limitProbe: { claudeToken: 'tok-probe' },
      });

      await patch({ limitsRefreshMin: 0 }).expect(200);
      expect((await configOf(key)).body.limitProbe).toBeNull();
    });

    it("cannot be requested for a worker that is not connected yet, nor for someone else's", async () => {
      const { accessToken } = await owner();
      const pending = await addWorker(accessToken, 'probe-pending');

      await as(
        request(server()).post(
          `/api/v1/workers/${pending.worker.id}/refresh-limits`,
        ),
        accessToken,
      ).expect(409);

      const other = await owner();

      await as(
        request(server()).post(
          `/api/v1/workers/${pending.worker.id}/refresh-limits`,
        ),
        other.accessToken,
      ).expect(404);
    });

    it('a probe report puts the limits on the worker and on the token its jobs use', async () => {
      const { accessToken, token, w, key } = await enrolled('probe-c');

      await request(server())
        .post('/api/v1/worker/jobs/usage')
        .set('Authorization', `Bearer ${key}`)
        .send({ probe: true, limits })
        .expect(204);

      const workers = await as(
        request(server()).get('/api/v1/workers'),
        accessToken,
      ).expect(200);
      const mine = (
        workers.body as {
          id: number;
          claudeLimits: {
            windows: Record<string, { utilization: number }>;
          } | null;
        }[]
      ).find((row) => row.id === w.worker.id);

      expect(mine?.claudeLimits?.windows.five_hour.utilization).toBe(0.31);

      const credentials = await as(
        request(server()).get('/api/v1/worker/claude-credentials'),
        accessToken,
      ).expect(200);
      const stored = (
        credentials.body as { id: number; limits: { windows: object } | null }[]
      ).find((row) => row.id === token.id);

      expect(stored?.limits?.windows).toHaveProperty('five_hour');
    });
  });

  describe("a worker's own VPN link", () => {
    const LINK =
      'vless://3f1c2d4e-0000-4000-8000-000000000001@vpn.example.com:8443?security=reality&type=tcp&pbk=PUBKEY-SECRET&sni=www.example.org&fp=firefox&sid=ab12';

    it('is stored encrypted, shown only as host:port, and handed only to that worker; "" removes it', async () => {
      const { accessToken } = await owner();
      const w = await addWorker(accessToken, 'vpn-w', { vpnLink: LINK });
      const { key } = await enroll(w.enrollCode);

      expect(JSON.stringify(w)).not.toContain('PUBKEY-SECRET');
      expect((w.worker as unknown as { vpnHost: string }).vpnHost).toBe(
        'vpn.example.com:8443',
      );

      const listed = await as(
        request(server()).get('/api/v1/workers'),
        accessToken,
      ).expect(200);

      expect(JSON.stringify(listed.body)).not.toContain('PUBKEY-SECRET');

      const raw = await app
        .get(DataSource)
        .query('SELECT "vpnLink" FROM workers WHERE id = $1', [w.worker.id]);

      expect(String(raw[0].vpnLink)).not.toContain('vpn.example.com');

      const config = await request(server())
        .get('/api/v1/workers/me/config')
        .set('Authorization', `Bearer ${key}`)
        .expect(200);

      expect(config.body.vpnLink).toBe(LINK);

      await as(
        request(server()).patch(`/api/v1/workers/${w.worker.id}`),
        accessToken,
      )
        .send({ vpnLink: '' })
        .expect(200);

      const cleared = await request(server())
        .get('/api/v1/workers/me/config')
        .set('Authorization', `Bearer ${key}`)
        .expect(200);

      expect(cleared.body.vpnLink).toBeNull();
    });

    it('refuses a link the worker could not use', async () => {
      const { accessToken } = await owner();
      const w = await addWorker(accessToken, 'vpn-bad');

      for (const vpnLink of [
        'hello',
        'vless://u@h:1?security=tls&pbk=k&sni=s',
      ]) {
        await as(
          request(server()).patch(`/api/v1/workers/${w.worker.id}`),
          accessToken,
        )
          .send({ vpnLink })
          .expect(400);
      }
    });
  });

  describe('stored API keys for gpt / deepseek / qwen', () => {
    it('are kept encrypted, listed without the key, and handed only to the worker that claims the job', async () => {
      const { accessToken, userId } = await owner();
      const w = await addWorker(accessToken, 'keys');
      const { key } = await enroll(w.enrollCode);

      const created = await as(
        request(server()).post('/api/v1/worker/provider-credentials'),
        accessToken,
      )
        .send({
          provider: 'deepseek',
          name: 'personal',
          apiKey: 'sk-secret-value-1234',
          baseUrl: 'https://api.example/v1',
          model: 'deepseek-chat',
        })
        .expect(201);

      expect(created.body).toMatchObject({
        provider: 'deepseek',
        name: 'personal',
        keyHint: '…1234',
      });
      expect(JSON.stringify(created.body)).not.toContain('sk-secret');

      const listed = await as(
        request(server()).get('/api/v1/worker/provider-credentials'),
        accessToken,
      ).expect(200);

      expect(JSON.stringify(listed.body)).not.toContain('sk-secret');

      await job(userId, accessToken, { model: 'deepseek' });

      const claimed = await request(server())
        .post('/api/v1/worker/jobs/claim')
        .set('Authorization', `Bearer ${key}`)
        .send({})
        .expect(200);

      expect(claimed.body.provider).toEqual({
        apiKey: 'sk-secret-value-1234',
        baseUrl: 'https://api.example/v1',
        model: 'deepseek-chat',
      });

      // the worker itself cannot list the keys
      await request(server())
        .get('/api/v1/worker/provider-credentials')
        .set('Authorization', `Bearer ${key}`)
        .expect(401);
    });

    it('a job can name one, but only of its own provider and its own account', async () => {
      const { accessToken, userId } = await owner();
      const other = await owner();
      const mine = await as(
        request(server()).post('/api/v1/worker/provider-credentials'),
        accessToken,
      )
        .send({ provider: 'gpt', name: 'mine', apiKey: 'sk-mine-0001' })
        .expect(201);
      const theirs = await as(
        request(server()).post('/api/v1/worker/provider-credentials'),
        other.accessToken,
      )
        .send({ provider: 'gpt', name: 'theirs', apiKey: 'sk-theirs-0002' })
        .expect(201);
      const file = await app
        .get(StorageService)
        .createFromBuffer(userId, Buffer.from('p'), 'p.zip');
      const create = (providerCredentialId: number, model = 'gpt') =>
        as(request(server()).post('/api/v1/worker/jobs'), accessToken).send({
          sourceFileId: file.id,
          model,
          providerCredentialId,
        });

      await create((mine.body as { id: number }).id).expect(201);
      await create((theirs.body as { id: number }).id).expect(400);
      await create((mine.body as { id: number }).id, 'qwen').expect(400);
    });

    it('can be deleted', async () => {
      const { accessToken } = await owner();
      const created = await as(
        request(server()).post('/api/v1/worker/provider-credentials'),
        accessToken,
      )
        .send({ provider: 'qwen', name: 'tmp', apiKey: 'sk-tmp-0003' })
        .expect(201);
      const id = (created.body as { id: number }).id;

      await as(
        request(server()).delete(`/api/v1/worker/provider-credentials/${id}`),
        accessToken,
      ).expect(204);
      await as(
        request(server()).delete(`/api/v1/worker/provider-credentials/${id}`),
        accessToken,
      ).expect(404);
    });
  });

  describe('deleting a worker', () => {
    it('revokes its key at once, fails what it was running and frees the jobs pinned to it', async () => {
      const { accessToken, userId } = await owner();
      const w = await addWorker(accessToken, 'doomed');
      const { key } = await enroll(w.enrollCode);
      const running = await job(userId, accessToken);

      await request(server())
        .post('/api/v1/worker/jobs/claim')
        .set('Authorization', `Bearer ${key}`)
        .send({})
        .expect(200);

      const pinned = await job(userId, accessToken, {
        targetWorkerId: w.worker.id,
      });

      const deleted = await as(
        request(server()).delete(`/api/v1/workers/${w.worker.id}`),
        accessToken,
      ).expect(200);

      expect(deleted.body).toEqual({ failedJobs: 1 });

      await request(server())
        .get('/api/v1/workers/me/config')
        .set('Authorization', `Bearer ${key}`)
        .expect(401);
      await request(server())
        .post('/api/v1/worker/jobs/claim')
        .set('Authorization', `Bearer ${key}`)
        .send({})
        .expect(401);

      // (a plain GET :id — without ?logsFrom — used to answer 400 behind the app-wide ValidationPipe)
      const failed = await as(
        request(server()).get(`/api/v1/worker/jobs/${running.id}`),
        accessToken,
      ).expect(200);

      expect(failed.body).toMatchObject({ status: 'failed', workerId: null });
      expect(failed.body.errorMessage).toContain('deleted by the owner');

      // the pinned queued job stays queued, no longer pinned: any worker may take it
      const freed = await as(
        request(server()).get(`/api/v1/worker/jobs/${pinned.id}`),
        accessToken,
      ).expect(200);

      expect(freed.body).toMatchObject({
        status: 'queued',
        targetWorkerId: null,
      });
    });

    it('is the owner’s alone', async () => {
      const mine = await owner();
      const stranger = await owner();
      const w = await addWorker(mine.accessToken, 'mine');

      await as(
        request(server()).delete(`/api/v1/workers/${w.worker.id}`),
        stranger.accessToken,
      ).expect(404);
      await as(
        request(server()).patch(`/api/v1/workers/${w.worker.id}`),
        stranger.accessToken,
      )
        .send({ name: 'taken' })
        .expect(404);
    });
  });

  describe('legacy workers and the status', () => {
    it('a worker on a personal API key still works, shows in the list as legacy, and counts as up', async () => {
      const { accessToken, userId } = await owner();
      const apiKey = await app.get(ApiKeysService).create(userId, 'legacy');

      await request(server())
        .post('/api/v1/worker/jobs/claim')
        .set('Authorization', `Bearer ${apiKey.token}`)
        .send({ workerName: 'old-green' })
        .expect(204);

      const listed = await as(
        request(server()).get('/api/v1/workers'),
        accessToken,
      ).expect(200);

      expect(listed.body).toEqual([
        expect.objectContaining({
          id: null,
          name: 'old-green',
          kind: 'legacy',
          state: 'idle',
        }),
      ]);

      const status = await as(
        request(server()).get('/api/v1/worker/status'),
        accessToken,
      ).expect(200);

      expect(status.body.isUp).toBe(true);

      await as(
        request(server()).delete('/api/v1/workers/legacy/old-green'),
        accessToken,
      ).expect(204);
    });

    it('a managed worker that is online makes the status "up"', async () => {
      const { accessToken } = await owner();
      const w = await addWorker(accessToken, 'live');

      const before = await as(
        request(server()).get('/api/v1/worker/status'),
        accessToken,
      ).expect(200);

      expect(before.body.isUp).toBe(false);

      await enroll(w.enrollCode);

      const after = await as(
        request(server()).get('/api/v1/worker/status'),
        accessToken,
      ).expect(200);

      expect(after.body.isUp).toBe(true);
    });
  });
});
