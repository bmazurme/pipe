import { MigrationInterface, QueryRunner } from 'typeorm';

// Quiet weekends, and whether urgent notifications may break the silence.
export class AddNotificationQuietWeekendsUrgent1796300000000 implements MigrationInterface {
  name = 'AddNotificationQuietWeekendsUrgent1796300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notification_settings" ADD "quietWeekends" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification_settings" ADD "allowUrgent" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notification_settings" DROP COLUMN "allowUrgent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification_settings" DROP COLUMN "quietWeekends"`,
    );
  }
}
