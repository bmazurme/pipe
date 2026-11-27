import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddImproveClarify1799900000000 implements MigrationInterface {
  name = 'AddImproveClarify1799900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "improve_runs" ADD "contextId" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "improve_settings" ADD "clarifyBeforeRun" character varying(8) NOT NULL DEFAULT 'off'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "improve_settings" DROP COLUMN "clarifyBeforeRun"`,
    );
    await queryRunner.query(
      `ALTER TABLE "improve_runs" DROP COLUMN "contextId"`,
    );
  }
}
