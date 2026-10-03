import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { ClaudeCredential } from '../src/worker/entities/claude-credential.entity';
import { User } from '../src/users/entities/user.entity';

// Same ntlstl-db-test database as app.e2e-spec.ts — see its own comment.
// Proves the transformer (src/crypto/encrypted-column.transformer.ts) is
// actually wired into the real TypeORM pipeline, not just correct in
// isolation (encrypted-column.transformer.spec.ts already covers that) —
// a row saved through the real repository must be unreadable as plaintext
// via a raw SQL query, and still round-trip correctly through the entity.
describe('Encrypted columns (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    process.env.POSTGRES_DB = 'ntlstl-db-test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    dataSource = app.get(getDataSourceToken());
  });

  afterAll(async () => {
    await app.close();
  });

  it('stores ClaudeCredential.token encrypted at rest, and decrypts it correctly on read', async () => {
    const userRepo = dataSource.getRepository(User);
    const credentialRepo = dataSource.getRepository(ClaudeCredential);

    const user = await userRepo.save({
      email: `e2e-enc-${Date.now()}@ntlstl.test`,
    });
    const plaintextToken = 'sk-ant-oat-super-secret-value';

    const saved = await credentialRepo.save({
      userId: user.id,
      name: 'e2e test credential',
      token: plaintextToken,
    });

    // Raw SQL bypasses TypeORM's column transformer entirely — this is
    // what a DB dump or pgadmin access would actually see.
    const [raw] = await dataSource.query(
      'SELECT token FROM claude_credentials WHERE id = $1',
      [saved.id],
    );
    expect(raw.token).not.toBe(plaintextToken);
    expect(raw.token).not.toContain(plaintextToken);
    expect(raw.token.split(':')).toHaveLength(4); // "<keyId>:<iv>:<authTag>:<ciphertext>"

    // The repository (which does run the transformer) still gets the
    // original plaintext back.
    const reloaded = await credentialRepo.findOneByOrFail({ id: saved.id });
    expect(reloaded.token).toBe(plaintextToken);

    await credentialRepo.delete(saved.id);
    await userRepo.delete(user.id);
  });
});
