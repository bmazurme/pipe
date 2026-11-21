import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { SessionsService } from '../src/auth/sessions.service';
import { UsersService } from '../src/users/users.service';

// Same ntlstl-db-test database as app.e2e-spec.ts. bridge's own VPN tunnel is the owner's to look at: one browser session, no API key.
describe('Bridge tunnel status (e2e)', () => {
  let app: INestApplication<App>;
  let owner: string;
  let stranger: string;
  const ownerEmail = `e2e-tunnel-owner-${Date.now()}@ntlstl.test`;
  const strangerEmail = `e2e-tunnel-stranger-${Date.now()}@ntlstl.test`;

  async function tokenFor(email: string): Promise<string> {
    const user = await app.get(UsersService).create({ email });
    const session = await app
      .get(SessionsService)
      .createSession(user.id, 'jest', '127.0.0.1');

    return app.get(JwtService).sign({ sub: user.id, sessionId: session.id });
  }

  beforeAll(async () => {
    process.env.POSTGRES_DB = 'ntlstl-db-test';
    process.env.EMAILS = `${ownerEmail},${strangerEmail}`;
    // No tunnel process in a test: nothing is started, only the route is looked at.
    process.env.BRIDGE_TUNNEL = 'off';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    owner = await tokenFor(ownerEmail);
    stranger = await tokenFor(strangerEmail);
  });

  afterAll(async () => {
    delete process.env.EMAILS;
    delete process.env.BRIDGE_TUNNEL;
    await app.close();
  });

  it('refuses a request with no token (401) and an account that is not the owner (403)', async () => {
    const http = () => request(app.getHttpServer());

    await http().get('/api/v1/vpn/bridge-tunnel').expect(401);
    process.env.EMAILS = ownerEmail;
    await http()
      .get('/api/v1/vpn/bridge-tunnel')
      .set('Authorization', `Bearer ${stranger}`)
      .expect(403);
  });

  it('tells the owner the tunnel is off when it is switched off', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/vpn/bridge-tunnel')
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);

    expect(res.body).toMatchObject({
      mode: 'off',
      inUse: false,
      links: 0,
      checks: [],
    });
    expect(res.body.reason).toContain('BRIDGE_TUNNEL=off');
  });
});
