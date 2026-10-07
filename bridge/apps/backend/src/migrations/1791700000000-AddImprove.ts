import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddImprove1791700000000 implements MigrationInterface {
  name = 'AddImprove1791700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "improve_runs" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "issueNumber" integer NOT NULL, "issueTitle" character varying(255) NOT NULL, "model" character varying(16) NOT NULL, "trigger" character varying(16) NOT NULL DEFAULT 'manual', "scheduleId" integer, "status" character varying(24) NOT NULL DEFAULT 'queued', "jobId" integer, "baseSha" character varying(64), "baseline" text, "branch" character varying(255), "prNumber" integer, "prUrl" character varying(255), "note" text, "error" text, "finishedAt" TIMESTAMP, CONSTRAINT "PK_improve_runs_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_improve_runs_issueNumber_status" ON "improve_runs" ("issueNumber", "status")`,
    );
    await queryRunner.query(
      `CREATE TABLE "improve_schedules" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "name" character varying(100) NOT NULL, "enabled" boolean NOT NULL DEFAULT true, "hour" smallint NOT NULL, "minute" smallint NOT NULL, "timezone" character varying(64) NOT NULL, "count" smallint NOT NULL, "model" character varying(16) NOT NULL, "label" character varying(64) NOT NULL DEFAULT 'loop', "lastRunOn" character varying(10), "lastRunAt" TIMESTAMP, "lastResult" text, CONSTRAINT "PK_improve_schedules_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "improve_settings" ("userId" integer NOT NULL, "autoStartModel" character varying(16), "autoStartSince" TIMESTAMP, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_improve_settings_userId" PRIMARY KEY ("userId"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "improve_settings"`);
    await queryRunner.query(`DROP TABLE "improve_schedules"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_improve_runs_issueNumber_status"`,
    );
    await queryRunner.query(`DROP TABLE "improve_runs"`);
  }
}
