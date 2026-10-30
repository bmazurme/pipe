import { MigrationInterface, QueryRunner } from 'typeorm';

// A board's agent now also reports its root disk and its SSH door.
export class AddBoardReportHealth1796100000000 implements MigrationInterface {
  name = 'AddBoardReportHealth1796100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "board_reports" ADD "health" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "board_reports" DROP COLUMN "health"`);
  }
}
