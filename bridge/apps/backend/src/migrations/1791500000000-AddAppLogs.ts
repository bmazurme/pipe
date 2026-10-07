import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAppLogs1791500000000 implements MigrationInterface {
  name = 'AddAppLogs1791500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "app_logs" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "level" character varying(8) NOT NULL, "source" character varying(16) NOT NULL, "event" character varying(64) NOT NULL, "message" character varying(500) NOT NULL, "meta" text, CONSTRAINT "PK_app_logs_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_app_logs_level" ON "app_logs" ("level")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_app_logs_source_level" ON "app_logs" ("source", "level")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "app_logs"`);
  }
}
