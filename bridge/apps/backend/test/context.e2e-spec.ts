import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { SessionsService } from '../src/auth/sessions.service';
import { ChatService } from '../src/chat/chat.service';
import { ChatModel } from '../src/chat/entities/chat.entity';
import { StoredFile } from '../src/storage/entities/stored-file.entity';
import { UsersService } from '../src/users/users.service';
import { JobModel } from '../src/worker/entities/job.entity';

// Context and ChatAttachment were once missing from the root TypeORM entity list:
// the app booted, then every query on either failed with EntityMetadataNotFoundError
// (a 500). These go through the real DataSource, which the unit specs' mocked
// repositories never touch.
describe('Contexts and chat attachments (e2e)', () => {
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

  it('GET /api/v1/contexts returns an empty list for a new user', async () => {
    const { accessToken } = await authenticatedUser();

    await authed(
      request(app.getHttpServer()).get('/api/v1/contexts'),
      accessToken,
    )
      .expect(200)
      .expect([]);
  });

  it('creates a context and lists it back', async () => {
    const { accessToken } = await authenticatedUser();

    const created = await authed(
      request(app.getHttpServer()).post('/api/v1/contexts'),
      accessToken,
    )
      .send({ name: 'Conventions', content: 'Use tabs.' })
      .expect(201);

    expect(created.body).toMatchObject({
      name: 'Conventions',
      content: 'Use tabs.',
    });

    const listed = await authed(
      request(app.getHttpServer()).get('/api/v1/contexts'),
      accessToken,
    ).expect(200);

    expect(listed.body).toHaveLength(1);
    expect(listed.body[0]).toMatchObject({ id: created.body.id });

    await authed(
      request(app.getHttpServer()).get(`/api/v1/contexts/${created.body.id}`),
      accessToken,
    )
      .expect(200)
      .expect((res) => expect(res.body.content).toBe('Use tabs.'));
  });

  it('launches a Worker job with a contextId', async () => {
    const { userId, accessToken } = await authenticatedUser();

    const context = await authed(
      request(app.getHttpServer()).post('/api/v1/contexts'),
      accessToken,
    )
      .send({ name: 'Notes', content: 'Run the linter first.' })
      .expect(201);

    const files = app.get(DataSource).getRepository(StoredFile);
    const sourceFile = await files.save({
      userId,
      originalName: 'parcel.zip',
      storedName: `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`,
      mimeType: 'application/zip',
      size: 1,
      channel: null,
      taskKey: null,
      direction: null,
    });

    const job = await authed(
      request(app.getHttpServer()).post('/api/v1/worker/jobs'),
      accessToken,
    )
      .send({
        sourceFileId: sourceFile.id,
        model: JobModel.Sonnet,
        contextId: context.body.id,
      })
      .expect(201);

    expect(job.body).toMatchObject({ contextName: 'Notes' });
  });

  it('returns a sent attachment in the claimed turn history', async () => {
    const { userId } = await authenticatedUser();
    const chatService = app.get(ChatService);

    const chat = await chatService.createChat(userId, {
      model: ChatModel.Sonnet,
    });
    // addAttachment only records what multer already wrote; no file is read here.
    const attachment = await chatService.addAttachment(chat.id, userId, {
      originalname: 'notes.txt',
      filename: `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
      size: 5,
    } as Express.Multer.File);

    await chatService.sendMessage(chat.id, userId, 'See the file', [
      attachment.id,
    ]);

    const claimed = await chatService.claim(userId);

    expect(claimed?.history).toEqual([
      expect.objectContaining({
        content: 'See the file',
        attachments: [
          expect.objectContaining({ id: attachment.id, name: 'notes.txt' }),
        ],
      }),
    ]);
  });
});
