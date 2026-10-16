import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkerLimitsRefresh1793400000000 implements MigrationInterface {
  name = 'AddWorkerLimitsRefresh1793400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workers" ADD "limitsRefreshMin" smallint NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "workers" ADD "limitsRefreshRequestedAt" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workers" DROP COLUMN "limitsRefreshRequestedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workers" DROP COLUMN "limitsRefreshMin"`,
    );
  }
}
