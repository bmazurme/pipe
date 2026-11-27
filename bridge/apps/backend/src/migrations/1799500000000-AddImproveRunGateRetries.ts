import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddImproveRunGateRetries1799500000000 implements MigrationInterface {
  name = 'AddImproveRunGateRetries1799500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "improve_runs" ADD "gateRetries" smallint NOT NULL DEFAULT '0'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "improve_runs" DROP COLUMN "gateRetries"`,
    );
  }
}
