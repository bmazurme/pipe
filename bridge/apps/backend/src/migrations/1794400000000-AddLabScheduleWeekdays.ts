import { MigrationInterface, QueryRunner } from 'typeorm';

// A Lab schedule can fire only on chosen weekdays (ISO 1 = Mon … 7 = Sun); null keeps every day, as before.
export class AddLabScheduleWeekdays1794400000000 implements MigrationInterface {
  name = 'AddLabScheduleWeekdays1794400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lab_schedules" ADD "weekdays" smallint array`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lab_schedules" DROP COLUMN "weekdays"`,
    );
  }
}
