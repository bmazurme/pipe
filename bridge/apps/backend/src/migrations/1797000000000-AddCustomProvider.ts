import { MigrationInterface, QueryRunner } from 'typeorm';

// A seventh model for jobs, 'custom': any OpenAI-compatible server (Yandex AI Studio, Gemini, Ollama, …) described entirely by a stored key,
// so a new service is a row in provider_credentials, not another enum value and migration.
export class AddCustomProvider1797000000000 implements MigrationInterface {
  name = 'AddCustomProvider1797000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ALTER TYPE … ADD VALUE is allowed inside a transaction since PostgreSQL 12; the new value just cannot be used before commit.
    await queryRunner.query(
      `ALTER TYPE "public"."jobs_model_enum" ADD VALUE IF NOT EXISTS 'custom'`,
    );
    await queryRunner.query(
      `ALTER TABLE "provider_credentials" ADD "route" character varying(8) NOT NULL DEFAULT 'auto'`,
    );
    await queryRunner.query(
      `ALTER TABLE "provider_credentials" ADD "authScheme" character varying(8) NOT NULL DEFAULT 'bearer'`,
    );
    await queryRunner.query(
      `ALTER TABLE "provider_credentials" ADD "extraHeaders" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "provider_credentials" ADD "timeoutSec" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "provider_credentials" ADD "supportsTools" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "provider_credentials" ADD "stream" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "provider_credentials" ADD "priceInPerMTok" numeric(10,4)`,
    );
    await queryRunner.query(
      `ALTER TABLE "provider_credentials" ADD "priceOutPerMTok" numeric(10,4)`,
    );
    await queryRunner.query(
      `ALTER TABLE "provider_credentials" ADD "preset" character varying(32)`,
    );
    await queryRunner.query(
      `ALTER TABLE "provider_credentials" ADD "allowedWorkerIds" integer array`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const column of [
      'allowedWorkerIds',
      'preset',
      'priceOutPerMTok',
      'priceInPerMTok',
      'stream',
      'supportsTools',
      'timeoutSec',
      'extraHeaders',
      'authScheme',
      'route',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "provider_credentials" DROP COLUMN "${column}"`,
      );
    }

    // A value cannot be dropped from an enum: custom jobs (and their keys) go, and the type is rebuilt without it.
    await queryRunner.query(`DELETE FROM "jobs" WHERE "model" = 'custom'`);
    await queryRunner.query(
      `DELETE FROM "provider_credentials" WHERE "provider" = 'custom'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."jobs_model_enum" RENAME TO "jobs_model_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."jobs_model_enum" AS ENUM('sonnet', 'opus', 'haiku', 'gpt', 'deepseek', 'qwen')`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" ALTER COLUMN "model" TYPE "public"."jobs_model_enum" USING "model"::"text"::"public"."jobs_model_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."jobs_model_enum_old"`);
  }
}
