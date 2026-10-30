import { MigrationInterface, QueryRunner } from 'typeorm';

// Redo an Improve pull request that conflicts with the base, instead of leaving it for a person.
export class AddImproveAutoRedoConflicts1796400000000 implements MigrationInterface {
  name = 'AddImproveAutoRedoConflicts1796400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "improve_settings" ADD "autoRedoConflicts" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "improve_settings" DROP COLUMN "autoRedoConflicts"`,
    );
  }
}
