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

// A11: chat that knows the system — the read tools bridge serves, and the snapshot a plain question about the system gets, for the owner only.
describe('Chat knows the system (e2e)', () => {
  let app: INestApplication<App>;
  const ownerEmail = `e2e-owner-${Date.now()}@ntlstl.test`;

  async function account(email: string) {
    const user = await app.get(UsersService).create({ email });
    const session = await app
      .get(SessionsService)
      .createSession(user.id, 'jest', '127.0.0.1');
    const accessToken = app
      .get(JwtService)
      .sign({ sub: user.id, sessionId: session.id });
    const key = await request(app.getHttpServer())
      .post('/api/v1/auth/api-keys')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'chat-tools' })
      .expect(201);
    const readonly = await request(app.getHttpServer())
      .post('/api/v1/auth/api-keys')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'ro', scope: 'readonly' })
      .expect(201);

    return {
      accessToken,
      key: key.body.token as string,
      readonlyKey: readonly.body.token as string,
    };
  }

  let owner: Awaited<ReturnType<typeof account>>;
  let stranger: Awaited<ReturnType<typeof account>>;

  const http = () => request(app.getHttpServer());

  // A chat with one message, claimed the way a worker claims it; returns the context the worker would be given.
  async function contextFor(
    who: typeof owner,
    message: string,
  ): Promise<string | null> {
    const chat = await http()
      .post('/api/v1/chat/chats')
      .set('Authorization', `Bearer ${who.accessToken}`)
      .send({ model: 'sonnet' })
      .expect(201);

    await http()
      .post(`/api/v1/chat/chats/${chat.body.id}/messages`)
      .set('Authorization', `Bearer ${who.accessToken}`)
      .send({ content: message })
      .expect(201);

    const claimed = await http()
      .post('/api/v1/chat/turns/claim')
      .set('X-Api-Key', who.key)
      .expect(200);

    return claimed.body.context;
  }

  beforeAll(async () => {
    process.env.POSTGRES_DB = 'ntlstl-db-test';
    // The shared test database already has an older first account; name this one the owner.
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

    owner = await account(ownerEmail);
    // EMAILS lists only the owner: another address cannot sign in, but a row made directly still exists and is a different account.
    process.env.EMAILS = `${ownerEmail}`;
    stranger = await account(`e2e-stranger-${Date.now()}@ntlstl.test`);
  });

  afterAll(async () => {
    delete process.env.EMAILS;
    await app.close();
  });

  describe('the tools', () => {
    it('are three read tools, offered to the owner', async () => {
      const res = await http()
        .get('/api/v1/chat/tools')
        .set('X-Api-Key', owner.key)
        .expect(200);

      expect(
        res.body.definitions.map(
          (d: { function: { name: string } }) => d.function.name,
        ),
      ).toEqual(['system_status', 'explain_run', 'recent_runs']);
      expect(res.body.prompt).toContain('read-only');
    });

    it('are not offered to anyone else', async () => {
      const res = await http()
        .get('/api/v1/chat/tools')
        .set('X-Api-Key', stranger.key)
        .expect(200);

      expect(res.body).toEqual({ definitions: [], prompt: '' });
      await http()
        .post('/api/v1/chat/tools/call')
        .set('X-Api-Key', stranger.key)
        .send({ name: 'system_status' })
        .expect(403);
    });

    it('answer «what is wrong now» from the real system', async () => {
      const res = await http()
        .post('/api/v1/chat/tools/call')
        .set('X-Api-Key', owner.key)
        .send({ name: 'system_status' })
        .expect(200);

      expect(res.body.result).toContain('What is wrong now');
      expect(res.body.result).toContain(
        'Bridge: up, database reachable, migrations applied.',
      );
    });

    it('say that a run which does not exist does not exist', async () => {
      const res = await http()
        .post('/api/v1/chat/tools/call')
        .set('X-Api-Key', owner.key)
        .send({ name: 'explain_run', args: { id: 999999 } })
        .expect(200);

      expect(res.body.result).toContain(
        'Neither an Improve run nor a Worker job with the number 999999',
      );
    });

    it('list recent runs as JSON', async () => {
      const res = await http()
        .post('/api/v1/chat/tools/call')
        .set('X-Api-Key', owner.key)
        .send({ name: 'recent_runs', args: { limit: 3 } })
        .expect(200);

      expect(Array.isArray(JSON.parse(res.body.result))).toBe(true);
    });

    it('cannot write: a tool that would is simply not there', async () => {
      await http()
        .post('/api/v1/chat/tools/call')
        .set('X-Api-Key', owner.key)
        .send({ name: 'create_job', args: { sourceFileId: 1, model: 'opus' } })
        .expect(404);
    });

    it('are for machine callers: a browser session, a read-only key and nobody are refused', async () => {
      await http()
        .get('/api/v1/chat/tools')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(403);
      await http()
        .get('/api/v1/chat/tools')
        .set('X-Api-Key', owner.readonlyKey)
        .expect(403);
      // no credentials at all: a machine-only route says so before it asks who you are
      await http().get('/api/v1/chat/tools').expect(403);
    });
  });

  describe('the snapshot in a turn', () => {
    it('is put in front of the model when the owner asks what is broken', async () => {
      const context = await contextFor(owner, 'что сломалось?');

      expect(context).toContain('Live system snapshot');
      expect(context).toContain('What is wrong now');
    });

    it('is a run explained, when the owner asks to explain one', async () => {
      const context = await contextFor(owner, 'объясни запуск 999999');

      expect(context).toContain('Neither an Improve run nor a Worker job');
    });

    it('is not added to an ordinary message', async () => {
      expect(await contextFor(owner, 'напиши функцию сортировки')).toBeNull();
    });

    it('is not given to an account that is not the owner', async () => {
      expect(await contextFor(stranger, 'что сломалось?')).toBeNull();
    });
  });
});
