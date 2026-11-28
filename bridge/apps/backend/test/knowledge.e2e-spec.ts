import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { SessionsService } from '../src/auth/sessions.service';
import { GithubApiService } from '../src/loop/github-api.service';
import { UsersService } from '../src/users/users.service';

// A8: saving a piece of knowledge opens a pull request that adds it to the repository — for the owner only, through
// the whole HTTP stack, with GitHub itself replaced by a recorder.
describe('Knowledge → repository (e2e)', () => {
  let app: INestApplication<App>;
  const ownerEmail = `e2e-knowledge-owner-${Date.now()}@ntlstl.test`;
  let ownerToken: string;
  let strangerToken: string;
  const http = () => request(app.getHttpServer());

  const blobs: string[] = [];
  const pulls: Array<{ title: string; head: string; body: string }> = [];
  const github = {
    isReady: () => true,
    baseBranch: () => 'main',
    getBranchSha: async () => 'base-sha',
    getFileText: async () => '# CLAUDE.md\n\nText.\n',
    getCommitTreeSha: async () => 'base-tree',
    createBlob: async (bytes: Uint8Array) => {
      blobs.push(Buffer.from(bytes).toString('utf-8'));

      return 'blob-sha';
    },
    createTree: async () => 'tree-sha',
    createCommit: async () => 'commit-sha',
    createBranch: async () => undefined,
    createPull: async (input: {
      title: string;
      head: string;
      body: string;
    }) => {
      pulls.push(input);

      return { number: 501, htmlUrl: 'https://github.com/o/r/pull/501' };
    },
    addLabels: async () => undefined,
    deleteBranch: async () => undefined,
  };

  async function session(email: string) {
    const user = await app.get(UsersService).create({ email });
    const s = await app
      .get(SessionsService)
      .createSession(user.id, 'jest', '127.0.0.1');

    return app.get(JwtService).sign({ sub: user.id, sessionId: s.id });
  }

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
      .overrideProvider(GithubApiService)
      .useValue(github)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    ownerToken = await session(ownerEmail);
    strangerToken = await session(
      `e2e-knowledge-stranger-${Date.now()}@ntlstl.test`,
    );
  });

  afterAll(async () => {
    delete process.env.EMAILS;
    await app.close();
  });

  const body = {
    title: 'Порт reports',
    text: 'Сервер слушает :4000.',
    target: 'claude-md',
    source: 'вопрос 12-3',
  };

  it('opens a pull request with the entry for the owner', async () => {
    const res = await http()
      .post('/api/v1/improve/knowledge')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(body)
      .expect(201);

    expect(res.body).toMatchObject({
      number: 501,
      url: 'https://github.com/o/r/pull/501',
      path: 'CLAUDE.md',
    });
    expect(blobs[0]).toContain('## Постоянные знания');
    expect(blobs[0]).toContain('- **Порт reports.** Сервер слушает :4000.');
    expect(pulls[0].title).toBe('Знание: Порт reports');
  });

  it('is the owner’s alone, and needs a session', async () => {
    const before = pulls.length;

    await http()
      .post('/api/v1/improve/knowledge')
      .set('Authorization', `Bearer ${strangerToken}`)
      .send(body)
      .expect(403);
    await http().post('/api/v1/improve/knowledge').send(body).expect(401);

    expect(pulls).toHaveLength(before);
  });

  it('refuses a bad body and a key, before anything is sent to GitHub', async () => {
    const before = pulls.length;
    const post = (payload: object) =>
      http()
        .post('/api/v1/improve/knowledge')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(payload);

    await post({ ...body, target: 'readme' }).expect(400);
    await post({ ...body, title: '' }).expect(400);
    await post({ ...body, text: 'x'.repeat(6001) }).expect(400);

    const key = await post({
      ...body,
      text: 'ключ ghp_AbCdEfGhIjKlMnOpQrSt1234',
    }).expect(400);

    expect(JSON.stringify(key.body)).toContain('похоже на ключ');
    expect(pulls).toHaveLength(before);
  });
});
