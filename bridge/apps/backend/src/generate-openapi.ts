import './pg-timestamp-parser';

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { swaggerConfig } from './config/swagger.config';

// Dumps the OpenAPI document to a committed JSON file — run after any
// controller/DTO change (`npm run openapi:generate`), checked in CI
// (`npm run openapi:check`) so a stale spec fails the build instead of
// silently drifting from the real API (see IMPROVEMENTS_TECH.md 2.2).
// Needs a real DB connection to boot (TypeOrmModule connects as part of
// Nest's own module init) — same requirement as the e2e suite, which is
// why this runs in the same CI job, after the same Postgres service
// container is up.
async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  const document = SwaggerModule.createDocument(app, swaggerConfig);

  const outPath = join(__dirname, '../openapi.json');
  writeFileSync(outPath, JSON.stringify(document, null, 2) + '\n');

  await app.close();
  console.log(`Wrote OpenAPI document to ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
