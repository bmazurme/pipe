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

// S7: a key typed into a chat, or written by the model, is not what ends up stored — nor what the worker is handed as history.
describe('Chat keeps no credentials (e2e)', () => {
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

  const http = () => request(app.getHttpServer());
  const KEY = 'ghp_AbCdEfGhIjKlMnOpQrSt1234';
  const HIDDEN = '[скрыто: токен GitHub]';

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

    owner = await account(ownerEmail);
  });

  afterAll(async () => {
    delete process.env.EMAILS;
    await app.close();
  });

  it('stores a pasted key hidden, hands the worker the hidden text, and hides what the model echoes', async () => {
    const auth = { Authorization: `Bearer ${owner.accessToken}` };
    const chat = await http()
      .post('/api/v1/chat/chats')
      .set(auth)
      .send({ model: 'sonnet' })
      .expect(201);

    const sent = await http()
      .post(`/api/v1/chat/chats/${chat.body.id}/messages`)
      .set(auth)
      .send({ content: `клонируй с ${KEY}, token: refresh не работает` })
      .expect(201);

    expect(sent.body.userMessage.content).toBe(
      `клонируй с ${HIDDEN}, token: refresh не работает`,
    );

    const claimed = await http()
      .post('/api/v1/chat/turns/claim')
      .set('X-Api-Key', owner.key)
      .expect(200);

    expect(JSON.stringify(claimed.body.history)).not.toContain('AbCdEf');
    expect(JSON.stringify(claimed.body.history)).toContain(HIDDEN);

    await http()
      .post(`/api/v1/chat/turns/${claimed.body.messageId}/complete`)
      .set('X-Api-Key', owner.key)
      .send({ content: `ключ был ${KEY}`, reasoning: `смотрю на ${KEY}` })
      .expect(201);

    const stored = await http()
      .get(`/api/v1/chat/chats/${chat.body.id}/messages`)
      .set(auth)
      .expect(200);

    expect(JSON.stringify(stored.body)).not.toContain('AbCdEf');
    expect(stored.body.map((m: { content: string }) => m.content)).toEqual([
      `клонируй с ${HIDDEN}, token: refresh не работает`,
      `ключ был ${HIDDEN}`,
    ]);
  });
});
