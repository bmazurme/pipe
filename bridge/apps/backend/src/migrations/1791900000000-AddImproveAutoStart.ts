import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddImproveAutoStart1791900000000 implements MigrationInterface {
  name = 'AddImproveAutoStart1791900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "improve_schedules" ADD "autoStartIssues" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "improve_schedules" DROP COLUMN "autoStartIssues"`,
    );
  }
}
