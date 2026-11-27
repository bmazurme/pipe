import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBoardAutoUpdate1799800000000 implements MigrationInterface {
  name = 'AddBoardAutoUpdate1799800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "script_updates" ADD "targetDigest" character varying(80)`,
    );
    await queryRunner.query(
      `CREATE TABLE "board_auto_update_settings" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "enabled" boolean NOT NULL DEFAULT false, "window" character varying(16) NOT NULL DEFAULT '03:00-05:00', "timezone" character varying(64) NOT NULL DEFAULT 'Europe/Moscow', CONSTRAINT "PK_board_auto_update_settings_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_board_auto_update_settings_userId" ON "board_auto_update_settings" ("userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "board_auto_update_settings"`);
    await queryRunner.query(
      `ALTER TABLE "script_updates" DROP COLUMN "targetDigest"`,
    );
  }
}
