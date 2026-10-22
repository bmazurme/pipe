import { MigrationInterface, QueryRunner } from 'typeorm';

// A per-job time limit chosen at launch (seconds); null = the worker's own jobTimeoutSec, as before.
export class AddJobTimeoutSec1794700000000 implements MigrationInterface {
  name = 'AddJobTimeoutSec1794700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "jobs" ADD "timeoutSec" integer`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "timeoutSec"`);
  }
}
