import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEscalation1800100000000 implements MigrationInterface {
  name = 'AddEscalation1800100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "improve_runs" ADD "escalatedFromRunId" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "improve_runs" ADD "failureCause" character varying(16)`,
    );
    await queryRunner.query(
      `ALTER TABLE "improve_settings" ADD "escalateOnFailure" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "improve_settings" ADD "escalationCapTaskUsd" double precision NOT NULL DEFAULT '5'`,
    );
    await queryRunner.query(
      `ALTER TABLE "improve_settings" ADD "escalationCapDayUsd" double precision NOT NULL DEFAULT '20'`,
    );
    await queryRunner.query(
      `ALTER TABLE "improve_outcomes" ADD "escalatedFrom" character varying(16)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "improve_outcomes" DROP COLUMN "escalatedFrom"`,
    );
    await queryRunner.query(
      `ALTER TABLE "improve_settings" DROP COLUMN "escalationCapDayUsd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "improve_settings" DROP COLUMN "escalationCapTaskUsd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "improve_settings" DROP COLUMN "escalateOnFailure"`,
    );
    await queryRunner.query(
      `ALTER TABLE "improve_runs" DROP COLUMN "failureCause"`,
    );
    await queryRunner.query(
      `ALTER TABLE "improve_runs" DROP COLUMN "escalatedFromRunId"`,
    );
  }
}
