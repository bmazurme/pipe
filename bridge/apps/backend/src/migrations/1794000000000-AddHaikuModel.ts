import { MigrationInterface, QueryRunner } from 'typeorm';

// Haiku, a third Claude model next to Sonnet and Opus, for jobs and for chats.
export class AddHaikuModel1794000000000 implements MigrationInterface {
  name = 'AddHaikuModel1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ALTER TYPE … ADD VALUE is allowed inside a transaction since PostgreSQL 12; the new value just cannot be used before commit.
    await queryRunner.query(
      `ALTER TYPE "public"."jobs_model_enum" ADD VALUE IF NOT EXISTS 'haiku'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."chats_model_enum" ADD VALUE IF NOT EXISTS 'haiku'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // A value cannot be dropped from an enum: rows that already use it are moved to sonnet, and the type is rebuilt without it.
    for (const [table, type] of [
      ['jobs', 'jobs_model_enum'],
      ['chats', 'chats_model_enum'],
    ]) {
      await queryRunner.query(
        `UPDATE "${table}" SET "model" = 'sonnet' WHERE "model" = 'haiku'`,
      );
      await queryRunner.query(
        `ALTER TYPE "public"."${type}" RENAME TO "${type}_old"`,
      );
      await queryRunner.query(
        `CREATE TYPE "public"."${type}" AS ENUM('sonnet', 'opus', 'gpt', 'deepseek', 'qwen')`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "model" TYPE "public"."${type}" USING "model"::"text"::"public"."${type}"`,
      );
      await queryRunner.query(`DROP TYPE "public"."${type}_old"`);
    }
  }
}
