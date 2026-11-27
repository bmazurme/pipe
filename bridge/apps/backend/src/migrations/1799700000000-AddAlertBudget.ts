import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAlertBudget1799700000000 implements MigrationInterface {
  name = 'AddAlertBudget1799700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "telegram_outbox" ADD "kind" character varying(8) NOT NULL DEFAULT 'quiet'`,
    );
    await queryRunner.query(
      `CREATE TABLE "notify_days" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "day" character varying(10) NOT NULL, "sent" integer NOT NULL DEFAULT '0', "urgent" integer NOT NULL DEFAULT '0', "deduped" integer NOT NULL DEFAULT '0', "grouped" integer NOT NULL DEFAULT '0', "quiet" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_notify_days_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_notify_days_day" ON "notify_days" ("day")`,
    );
    await queryRunner.query(
      `CREATE TABLE "notify_kinds" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "day" character varying(10) NOT NULL, "kind" character varying(60) NOT NULL, "attempts" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_notify_kinds_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_notify_kinds_day_kind" ON "notify_kinds" ("day", "kind")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "notify_kinds"`);
    await queryRunner.query(`DROP TABLE "notify_days"`);
    await queryRunner.query(`ALTER TABLE "telegram_outbox" DROP COLUMN "kind"`);
  }
}
