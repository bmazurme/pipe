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

// A12: the review card of a pull request — for the owner only, through the whole HTTP stack, with GitHub itself replaced by a fake.
describe('PR review card (e2e)', () => {
  let app: INestApplication<App>;
  const ownerEmail = `e2e-review-owner-${Date.now()}@ntlstl.test`;
  let ownerToken: string;
  let strangerToken: string;
  const http = () => request(app.getHttpServer());

  const github = {
    isConfigured: () => true,
    getPull: async (number: number) => {
      if (number === 404) throw new Error('GitHub 404: Not Found');

      return {
        number,
        title: 'Add the thing',
        htmlUrl: `https://github.com/o/r/pull/${number}`,
        baseRef: 'main',
        headSha: 'abc123',
        mergeable: true,
        body: '**Проверка перед PR:** пройдена (x).',
      };
    },
    listPullFileStats: async () => [
      {
        path: 'bridge/apps/backend/src/a.ts',
        additions: 20,
        deletions: 2,
        status: 'modified',
      },
      { path: 'docs/a.md', additions: 3, deletions: 0, status: 'added' },
    ],
    ciState: async () => 'success',
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
      `e2e-review-stranger-${Date.now()}@ntlstl.test`,
    );
  });

  afterAll(async () => {
    delete process.env.EMAILS;
    await app.close();
  });

  it('gives the owner the card: diff, risk, checked and not checked', async () => {
    const res = await http()
      .get('/api/v1/improve/prs/12/review')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(res.body).toMatchObject({
      number: 12,
      risk: { level: 'medium' },
      diff: { files: 2, additions: 23, deletions: 2 },
      attention: ['Код изменён, а тестов среди файлов нет'],
      run: null,
    });
    expect(res.body.checked).toEqual(expect.arrayContaining(['CI зелёный']));
    expect(res.body.notChecked[0]).toContain('Diff человеком не читался');
  });

  it('is the owner’s alone, and needs a session', async () => {
    await http()
      .get('/api/v1/improve/prs/12/review')
      .set('Authorization', `Bearer ${strangerToken}`)
      .expect(403);
    await http().get('/api/v1/improve/prs/12/review').expect(401);
  });

  it('refuses a bad number and reports GitHub’s failure as a bad gateway', async () => {
    const get = (path: string) =>
      http().get(path).set('Authorization', `Bearer ${ownerToken}`);

    await get('/api/v1/improve/prs/abc/review').expect(400);
    await get('/api/v1/improve/prs/0/review').expect(400);

    const res = await get('/api/v1/improve/prs/404/review').expect(502);

    expect(res.body.message).toContain('GitHub 404');
  });
});
