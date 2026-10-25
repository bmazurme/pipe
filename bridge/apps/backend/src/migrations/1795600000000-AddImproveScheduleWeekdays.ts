import { MigrationInterface, QueryRunner } from 'typeorm';

// An Improve schedule can fire only on chosen weekdays (ISO 1 = Mon … 7 = Sun); null keeps every day, as before.
export class AddImproveScheduleWeekdays1795600000000 implements MigrationInterface {
  name = 'AddImproveScheduleWeekdays1795600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "improve_schedules" ADD "weekdays" smallint array`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "improve_schedules" DROP COLUMN "weekdays"`,
    );
  }
}
