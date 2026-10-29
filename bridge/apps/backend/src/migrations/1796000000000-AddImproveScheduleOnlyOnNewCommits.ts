import { MigrationInterface, QueryRunner } from 'typeorm';

// Analysis schedules can skip a night when the base branch has no new commits.
export class AddImproveScheduleOnlyOnNewCommits1796000000000 implements MigrationInterface {
  name = 'AddImproveScheduleOnlyOnNewCommits1796000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "improve_schedules" ADD "onlyOnNewCommits" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "improve_schedules" DROP COLUMN "onlyOnNewCommits"`,
    );
  }
}
