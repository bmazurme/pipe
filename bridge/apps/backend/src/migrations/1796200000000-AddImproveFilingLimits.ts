import { MigrationInterface, QueryRunner } from 'typeorm';

// The brake on automatic issue filing: a minimum value, open issues per direction, new issues per day.
export class AddImproveFilingLimits1796200000000 implements MigrationInterface {
  name = 'AddImproveFilingLimits1796200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "improve_settings" ADD "minValue" smallint NOT NULL DEFAULT 3`,
    );
    await queryRunner.query(
      `ALTER TABLE "improve_settings" ADD "maxOpenPerCategory" smallint NOT NULL DEFAULT 3`,
    );
    await queryRunner.query(
      `ALTER TABLE "improve_settings" ADD "dailyIssueCap" smallint NOT NULL DEFAULT 5`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "improve_settings" DROP COLUMN "dailyIssueCap"`,
    );
    await queryRunner.query(
      `ALTER TABLE "improve_settings" DROP COLUMN "maxOpenPerCategory"`,
    );
    await queryRunner.query(
      `ALTER TABLE "improve_settings" DROP COLUMN "minValue"`,
    );
  }
}
