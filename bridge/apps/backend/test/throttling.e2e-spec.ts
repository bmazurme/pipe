import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';

// Same ntlstl-db-test database as app.e2e-spec.ts — see its own comment.
describe('Rate limiting (e2e)', () => {
  let app: INestApplication<App>;

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

  // AuthController carries its own stricter @Throttle (limit: 20/60s) than
  // the app-wide default (300/60s) — this is what actually proves that
  // override is wired up, not just declared. checkAuth 401s without a
  // refresh cookie regardless, which is fine: ThrottlerGuard runs ahead of
  // RefreshTokenGuard and counts every request whether or not auth succeeds.
  it('returns 429 once the stricter auth-route limit is exceeded', async () => {
    let lastStatus = 0;

    for (let i = 0; i < 21; i++) {
      const response = await request(app.getHttpServer()).get(
        '/api/v1/auth/check',
      );
      lastStatus = response.status;
      if (lastStatus === 429) break;
    }

    expect(lastStatus).toBe(429);
  });
});
