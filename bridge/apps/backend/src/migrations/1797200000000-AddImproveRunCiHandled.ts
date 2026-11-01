import { MigrationInterface, QueryRunner } from 'typeorm';

// The CI watcher's once-per-head-commit guards, persisted so a restart does not re-run CI or repeat notifications.
export class AddImproveRunCiHandled1797200000000 implements MigrationInterface {
  name = 'AddImproveRunCiHandled1797200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "improve_runs" ADD "ciHandled" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "improve_runs" DROP COLUMN "ciHandled"`,
    );
  }
}
