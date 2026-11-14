import { lstat, mkdtemp, readFile, readlink, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { zipSync } from 'fflate';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { SessionsService } from '../src/auth/sessions.service';
import { UsersService } from '../src/users/users.service';

// Same ntlstl-db-test database as app.e2e-spec.ts — see its own comment. The promo module is the owner's alone, so this user is
// named the owner through EMAILS, and a second one is checked to be refused.
describe('Promo API (e2e)', () => {
  let app: INestApplication<App>;
  let landingDir: string;
  let owner: string;
  let stranger: string;
  const ownerEmail = `e2e-promo-owner-${Date.now()}@ntlstl.test`;

  async function tokenFor(email: string): Promise<string> {
    const user = await app.get(UsersService).create({ email });
    const session = await app
      .get(SessionsService)
      .createSession(user.id, 'jest', '127.0.0.1');

    return app.get(JwtService).sign({ sub: user.id, sessionId: session.id });
  }

  const as = (req: request.Test, token: string) =>
    req.set('Authorization', `Bearer ${token}`);
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    process.env.POSTGRES_DB = 'ntlstl-db-test';
    process.env.EMAILS = `${ownerEmail},e2e-promo-stranger@ntlstl.test`;
    landingDir = await mkdtemp(join(tmpdir(), 'e2e-landing-'));
    process.env.LANDING_DIR = landingDir;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    owner = await tokenFor(ownerEmail);
    stranger = await tokenFor('e2e-promo-stranger@ntlstl.test');
  });

  afterAll(async () => {
    delete process.env.EMAILS;
    delete process.env.LANDING_DIR;
    await app.close();
    await rm(landingDir, { recursive: true, force: true });
  });

  it('refuses a request with no token (401) and an account that is not the owner (403)', async () => {
    await http().get('/api/v1/promo/overview').expect(401);
    // EMAILS lists the stranger as allowed to sign in, but not as the owner
    process.env.EMAILS = ownerEmail;
    await as(http().get('/api/v1/promo/posts'), stranger).expect(403);
    await as(http().get('/api/v1/promo/landing'), stranger).expect(403);
    await as(http().get('/api/v1/promo/posts'), owner).expect(200);
  });

  it('runs a post from a draft to published, and checks the text against the channel limit', async () => {
    const created = await as(
      http()
        .post('/api/v1/promo/posts')
        .send({
          channel: 'telegram',
          title: 'e2e',
          textRu: 'а'.repeat(600),
          textEn: 'b'.repeat(500),
          scheduledAt: '2026-11-20T10:00:00.000Z',
          utmCampaign: 'p2',
        }),
      owner,
    ).expect(201);

    expect(created.body).toMatchObject({
      status: 'draft',
      mode: 'auto',
      captionLength: 1102,
      captionLimit: 4096,
    });

    const id = created.body.id as number;

    // a bad body is refused by validation, not by the database
    await as(
      http()
        .post('/api/v1/promo/posts')
        .send({ channel: 'tiktok', title: 'x' }),
      owner,
    ).expect(400);
    await as(http().get('/api/v1/promo/posts?status=nonsense'), owner).expect(
      400,
    );

    await as(http().post(`/api/v1/promo/posts/${id}/approve`), owner).expect(
      200,
    );
    expect(
      (await as(http().get(`/api/v1/promo/posts/${id}`), owner).expect(200))
        .body.status,
    ).toBe('approved');

    const published = await as(
      http()
        .post(`/api/v1/promo/posts/${id}/published`)
        .send({ externalUrl: 'https://t.me/c/1/2' }),
      owner,
    ).expect(200);

    expect(published.body).toMatchObject({
      status: 'published',
      externalUrl: 'https://t.me/c/1/2',
    });
    // a post that is out is a record: it cannot be edited any more
    await as(
      http().patch(`/api/v1/promo/posts/${id}`).send({ title: 'x' }),
      owner,
    ).expect(409);

    const overview = await as(
      http().get('/api/v1/promo/overview'),
      owner,
    ).expect(200);

    expect(
      overview.body.channels.find(
        (c: { channel: string }) => c.channel === 'telegram',
      ).counts.published,
    ).toBeGreaterThanOrEqual(1);
    expect(overview.body.landing).toMatchObject({ configured: true });
  });

  it('keeps an uploaded file, serves it back, and drops it from the posts that carried it', async () => {
    const asset = await as(
      http()
        .post('/api/v1/promo/assets')
        .attach('file', Buffer.from('not really a png'), 'frame.png'),
      owner,
    ).expect(201);

    expect(asset.body).toMatchObject({
      originalName: 'frame.png',
      mime: 'image/png',
      size: 16,
    });

    const served = await as(
      http().get(`/api/v1/promo/assets/${asset.body.id}/content`),
      owner,
    ).expect(200);

    expect(served.headers['content-type']).toMatch(/image\/png/);
    expect(served.headers['content-security-policy']).toContain('sandbox');

    const post = await as(
      http()
        .post('/api/v1/promo/posts')
        .send({
          channel: 'instagram',
          title: 'with file',
          textRu: 'x',
          assetIds: [asset.body.id],
        }),
      owner,
    ).expect(201);

    expect(post.body).toMatchObject({
      mode: 'reminder',
      assetIds: [asset.body.id],
    });

    await as(
      http()
        .post('/api/v1/promo/posts')
        .send({ channel: 'telegram', title: 'x', assetIds: [999999] }),
      owner,
    ).expect(400);
    await as(
      http()
        .post('/api/v1/promo/assets')
        .attach('file', Buffer.from('x'), 'run.exe'),
      owner,
    ).expect(400);

    await as(
      http().delete(`/api/v1/promo/assets/${asset.body.id}`),
      owner,
    ).expect(204);
    expect(
      (
        await as(
          http().get(`/api/v1/promo/posts/${post.body.id}`),
          owner,
        ).expect(200)
      ).body.assetIds,
    ).toEqual([]);
    await as(
      http().get(`/api/v1/promo/assets/${asset.body.id}/content`),
      owner,
    ).expect(404);
  });

  it('uploads a landing release, switches it on, and goes back', async () => {
    const zipOf = (title: string) =>
      Buffer.from(
        zipSync({
          'index.html': new TextEncoder().encode(`<h1>${title}</h1>`),
          'img/a.png': new Uint8Array([1, 2, 3]),
        }),
      );
    const upload = async (title: string) =>
      (
        await as(
          http()
            .post('/api/v1/promo/landing/releases')
            .field('label', title)
            .attach('file', zipOf(title), 'site.zip'),
          owner,
        ).expect(201)
      ).body;

    const first = await upload('first');
    const second = await upload('second');

    expect(first).toMatchObject({
      label: 'first',
      fileCount: 2,
      active: false,
    });
    // uploaded, but not live
    await expect(lstat(join(landingDir, 'current'))).rejects.toThrow();

    await as(
      http().post(`/api/v1/promo/landing/releases/${first.id}/activate`),
      owner,
    ).expect(200);
    expect(
      await readFile(join(landingDir, 'current', 'index.html'), 'utf8'),
    ).toBe('<h1>first</h1>');

    await as(
      http().post(`/api/v1/promo/landing/releases/${second.id}/activate`),
      owner,
    ).expect(200);
    expect(
      await readFile(join(landingDir, 'current', 'index.html'), 'utf8'),
    ).toBe('<h1>second</h1>');
    expect(await readlink(join(landingDir, 'current'))).toBe(
      join('releases', second.dirName),
    );

    // the live one cannot be deleted; the other one can
    await as(
      http().delete(`/api/v1/promo/landing/releases/${second.id}`),
      owner,
    ).expect(409);
    await as(
      http().delete(`/api/v1/promo/landing/releases/${first.id}`),
      owner,
    ).expect(204);

    const state = await as(http().get('/api/v1/promo/landing'), owner).expect(
      200,
    );

    expect(state.body.activeDirName).toBe(second.dirName);
    expect(
      state.body.releases.filter((r: { active: boolean }) => r.active),
    ).toHaveLength(1);

    // clean up for reruns on the shared database
    await as(
      http().post(`/api/v1/promo/landing/releases/${second.id}/activate`),
      owner,
    ).expect(200);
  });

  it('refuses a zip that is unsafe or is not a site', async () => {
    const bad = (entries: Record<string, Uint8Array>) =>
      as(
        http()
          .post('/api/v1/promo/landing/releases')
          .attach('file', Buffer.from(zipSync(entries)), 'bad.zip'),
        owner,
      );
    const bytes = new TextEncoder().encode('x');

    expect(
      (await bad({ 'page.html': bytes }).expect(400)).body.message,
    ).toMatch(/index\.html/);
    expect(
      (await bad({ 'index.html': bytes, 'run.php': bytes }).expect(400)).body
        .message,
    ).toMatch(/не разрешён/);
    expect(
      (await bad({ 'index.html': bytes, '../escape.html': bytes }).expect(400))
        .body.message,
    ).toMatch(/выходит/);
    await as(
      http()
        .post('/api/v1/promo/landing/releases')
        .attach('file', Buffer.from('plain text'), 'site.txt'),
      owner,
    ).expect(400);
  });
});
