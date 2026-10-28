import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { SessionsService } from '../src/auth/sessions.service';
import { UsersService } from '../src/users/users.service';

// Same ntlstl-db-test database as app.e2e-spec.ts — see its own comment.
// Only covers the validation gate itself (rejected before the controller
// method body runs) — not the full sync/provision flow, which needs real
// GitHub credentials this test environment doesn't have.
describe('VPN confirm gate (e2e)', () => {
  let app: INestApplication<App>;
  let accessToken: string;
  const email = `e2e-vpn-confirm-${Date.now()}@ntlstl.test`;

  beforeAll(async () => {
    process.env.POSTGRES_DB = 'ntlstl-db-test';
    // VPN routes are owner-only; the shared test database already has an
    // older first account, so name this user the owner through EMAILS.
    process.env.EMAILS = email;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    const usersService = app.get(UsersService);
    const sessionsService = app.get(SessionsService);
    const jwtService = app.get(JwtService);

    const user = await usersService.create({
      email,
    });
    const session = await sessionsService.createSession(
      user.id,
      'jest',
      '127.0.0.1',
    );
    accessToken = jwtService.sign({ sub: user.id, sessionId: session.id });
  });

  afterAll(async () => {
    delete process.env.EMAILS;
    await app.close();
  });

  it('rejects /vpn/sync without confirm: true', () => {
    return request(app.getHttpServer())
      .post('/api/v1/vpn/sync')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(400);
  });

  it('rejects /vpn/sync with confirm: false', () => {
    return request(app.getHttpServer())
      .post('/api/v1/vpn/sync')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ confirm: false })
      .expect(400);
  });
});
