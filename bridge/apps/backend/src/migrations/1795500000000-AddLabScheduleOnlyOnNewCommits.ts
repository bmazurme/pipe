import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLabScheduleOnlyOnNewCommits1795500000000 implements MigrationInterface {
  name = 'AddLabScheduleOnlyOnNewCommits1795500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lab_schedules" ADD "onlyOnNewCommits" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lab_schedules" DROP COLUMN "onlyOnNewCommits"`,
    );
  }
}
