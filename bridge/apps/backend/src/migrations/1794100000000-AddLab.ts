import { MigrationInterface, QueryRunner } from 'typeorm';

// Lab: personal GitHub projects, the owner's own schedules over them, and the runs they make.
export class AddLab1794100000000 implements MigrationInterface {
  name = 'AddLab1794100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "lab_projects" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "name" character varying(100) NOT NULL, "repo" character varying(200) NOT NULL, "baseBranch" character varying(100) NOT NULL DEFAULT 'main', "token" text NOT NULL, "tokenHint" character varying(16) NOT NULL, "checkedAt" TIMESTAMP, "canWrite" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_lab_projects_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_lab_projects_userId" ON "lab_projects" ("userId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "lab_projects" ADD CONSTRAINT "FK_lab_projects_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE TABLE "lab_schedules" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "projectId" integer NOT NULL, "name" character varying(100) NOT NULL, "enabled" boolean NOT NULL DEFAULT true, "hour" smallint NOT NULL, "minute" smallint NOT NULL, "timezone" character varying(64) NOT NULL, "model" character varying(16) NOT NULL, "task" text NOT NULL, "contextId" integer, "lastRunOn" character varying(10), "lastRunAt" TIMESTAMP, "lastResult" text, CONSTRAINT "PK_lab_schedules_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_lab_schedules_userId" ON "lab_schedules" ("userId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "lab_schedules" ADD CONSTRAINT "FK_lab_schedules_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    // A schedule is meaningless without its project: disconnecting the project removes it.
    await queryRunner.query(
      `ALTER TABLE "lab_schedules" ADD CONSTRAINT "FK_lab_schedules_projectId" FOREIGN KEY ("projectId") REFERENCES "lab_projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE TABLE "lab_runs" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "projectId" integer, "repo" character varying(200) NOT NULL, "scheduleId" integer, "trigger" character varying(16) NOT NULL DEFAULT 'manual', "title" character varying(255) NOT NULL, "task" text NOT NULL, "model" character varying(16) NOT NULL, "status" character varying(24) NOT NULL DEFAULT 'queued', "jobId" integer, "baseSha" character varying(64), "baseline" text, "branch" character varying(255), "prNumber" integer, "prUrl" character varying(255), "note" text, "error" text, "finishedAt" TIMESTAMP, CONSTRAINT "PK_lab_runs_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_lab_runs_userId_status" ON "lab_runs" ("userId", "status")`,
    );
    await queryRunner.query(
      `ALTER TABLE "lab_runs" ADD CONSTRAINT "FK_lab_runs_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    // The history outlives the project it ran on.
    await queryRunner.query(
      `ALTER TABLE "lab_runs" ADD CONSTRAINT "FK_lab_runs_projectId" FOREIGN KEY ("projectId") REFERENCES "lab_projects"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lab_runs" DROP CONSTRAINT "FK_lab_runs_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lab_runs" DROP CONSTRAINT "FK_lab_runs_userId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_lab_runs_userId_status"`);
    await queryRunner.query(`DROP TABLE "lab_runs"`);

    await queryRunner.query(
      `ALTER TABLE "lab_schedules" DROP CONSTRAINT "FK_lab_schedules_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lab_schedules" DROP CONSTRAINT "FK_lab_schedules_userId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_lab_schedules_userId"`);
    await queryRunner.query(`DROP TABLE "lab_schedules"`);

    await queryRunner.query(
      `ALTER TABLE "lab_projects" DROP CONSTRAINT "FK_lab_projects_userId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_lab_projects_userId"`);
    await queryRunner.query(`DROP TABLE "lab_projects"`);
  }
}
