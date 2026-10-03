import '../pg-timestamp-parser';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { ApiKeysService } from '../auth/api-keys.service';
import { UsersService } from '../users/users.service';

// Test-only utility, not reachable over HTTP: bridge has no public
// "create an arbitrary user" endpoint (correctly — that would be a
// privilege-escalation hole), so the cross-repo E2E pipeline test
// (scripts/e2e-cross-repo-pipeline.mjs at the repo root) seeds a throwaway
// user and a personal API key through the real application's own services
// instead of hand-rolling the password/token-hashing logic again here.
// Reuses the exact same NestFactory.createApplicationContext pattern as
// bridge's own e2e specs (see test/vpn-confirm.e2e-spec.ts) — no HTTP
// listener, just DI + the real Postgres connection.
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const usersService = app.get(UsersService);
    const apiKeysService = app.get(ApiKeysService);

    const email = `e2e-pipeline-${Date.now()}@ntlstl.test`;
    const user = await usersService.create({ email });
    const apiKey = await apiKeysService.create(user.id, 'e2e-pipeline');

    process.stdout.write(
      `${JSON.stringify({ userId: user.id, token: apiKey.token })}\n`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
