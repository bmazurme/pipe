import { MigrationInterface, QueryRunner } from 'typeorm';

// Seconds the owner added to a running job's time limit ("+30 мин"); null = never extended.
export class AddJobExtraTimeoutSec1795300000000 implements MigrationInterface {
  name = 'AddJobExtraTimeoutSec1795300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "jobs" ADD "extraTimeoutSec" integer`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "extraTimeoutSec"`);
  }
}
