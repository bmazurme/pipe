import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddJobCancellation1791600000000 implements MigrationInterface {
  name = 'AddJobCancellation1791600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ALTER TYPE … ADD VALUE is allowed inside a transaction since PostgreSQL 12,
    // as long as the new value is not used in the same transaction (it is not).
    await queryRunner.query(
      `ALTER TYPE "public"."jobs_status_enum" ADD VALUE IF NOT EXISTS 'cancelled'`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" ADD "cancelRequestedAt" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "jobs" DROP COLUMN "cancelRequestedAt"`,
    );
    // A removed enum value cannot be dropped in place: recreate the type without
    // 'cancelled', mapping any such job to 'failed' first.
    await queryRunner.query(
      `UPDATE "jobs" SET "status" = 'failed' WHERE "status" = 'cancelled'`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."jobs_status_enum" RENAME TO "jobs_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."jobs_status_enum" AS ENUM('queued', 'claimed', 'running', 'succeeded', 'failed')`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" ALTER COLUMN "status" TYPE "public"."jobs_status_enum" USING "status"::"text"::"public"."jobs_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" ALTER COLUMN "status" SET DEFAULT 'queued'`,
    );
    await queryRunner.query(`DROP TYPE "public"."jobs_status_enum_old"`);
  }
}
