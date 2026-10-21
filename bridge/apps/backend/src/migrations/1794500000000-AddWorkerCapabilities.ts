import { MigrationInterface, QueryRunner } from 'typeorm';

// Worker capabilities (what a worker can do besides running a model, e.g. 'fusion'), the capability a job requires, and where a Lab
// run or schedule is executed ('any' = any suitable worker, as before; 'fusion' = a worker with Fusion 360).
export class AddWorkerCapabilities1794500000000 implements MigrationInterface {
  name = 'AddWorkerCapabilities1794500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "workers" ADD "capabilities" text`);
    await queryRunner.query(
      `ALTER TABLE "jobs" ADD "requiredCapability" character varying(32)`,
    );
    await queryRunner.query(
      `ALTER TABLE "lab_schedules" ADD "executor" character varying(16) NOT NULL DEFAULT 'any'`,
    );
    await queryRunner.query(
      `ALTER TABLE "lab_runs" ADD "executor" character varying(16) NOT NULL DEFAULT 'any'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lab_runs" DROP COLUMN "executor"`);
    await queryRunner.query(
      `ALTER TABLE "lab_schedules" DROP COLUMN "executor"`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" DROP COLUMN "requiredCapability"`,
    );
    await queryRunner.query(`ALTER TABLE "workers" DROP COLUMN "capabilities"`);
  }
}
