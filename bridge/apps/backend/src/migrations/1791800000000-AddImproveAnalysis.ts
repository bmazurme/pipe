import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddImproveAnalysis1791800000000 implements MigrationInterface {
  name = 'AddImproveAnalysis1791800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "improve_runs" ADD "kind" character varying(16) NOT NULL DEFAULT 'issue'`,
    );
    await queryRunner.query(`ALTER TABLE "improve_runs" ADD "result" text`);
    await queryRunner.query(
      `ALTER TABLE "improve_runs" ALTER COLUMN "issueNumber" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "improve_schedules" ADD "kind" character varying(16) NOT NULL DEFAULT 'issues'`,
    );
    await queryRunner.query(
      `ALTER TABLE "improve_schedules" ADD "categories" character varying(128)`,
    );
    await queryRunner.query(
      `ALTER TABLE "improve_schedules" ADD "autoCreateIssues" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "improve_schedules" ADD "autoStartIssues" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "improve_schedules" DROP COLUMN "autoStartIssues"`,
    );
    await queryRunner.query(
      `ALTER TABLE "improve_schedules" DROP COLUMN "autoCreateIssues"`,
    );
    await queryRunner.query(
      `ALTER TABLE "improve_schedules" DROP COLUMN "categories"`,
    );
    await queryRunner.query(
      `ALTER TABLE "improve_schedules" DROP COLUMN "kind"`,
    );
    // Analysis runs have no issue number — they cannot satisfy NOT NULL again.
    await queryRunner.query(
      `DELETE FROM "improve_runs" WHERE "issueNumber" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "improve_runs" ALTER COLUMN "issueNumber" SET NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "improve_runs" DROP COLUMN "result"`);
    await queryRunner.query(`ALTER TABLE "improve_runs" DROP COLUMN "kind"`);
  }
}
