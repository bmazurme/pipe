import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNotificationSettings1791400000000 implements MigrationInterface {
  name = 'AddNotificationSettings1791400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "notification_settings" ("userId" integer NOT NULL, "quietHours" character varying(16) NOT NULL, "timezone" character varying(64) NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_notification_settings_userId" PRIMARY KEY ("userId"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "notification_settings"`);
  }
}
