import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddJobAutoRetry1799600000000 implements MigrationInterface {
  name = 'AddJobAutoRetry1799600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "jobs" ADD "autoRetryOfId" integer`);
    await queryRunner.query(`ALTER TABLE "jobs" ADD "avoidWorkerId" integer`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "avoidWorkerId"`);
    await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "autoRetryOfId"`);
  }
}
