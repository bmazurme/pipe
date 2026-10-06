import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLoopRuns1791000000000 implements MigrationInterface {
  name = 'AddLoopRuns1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "loop_runs" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "stage" character varying(32) NOT NULL DEFAULT 'analyzing', "title" character varying(255) NOT NULL, "prNumber" integer, "branch" character varying(255), "error" text, CONSTRAINT "PK_loop_runs_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_loop_runs_stage" ON "loop_runs" ("stage")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_loop_runs_prNumber" ON "loop_runs" ("prNumber")`,
    );
    await queryRunner.query(
      `CREATE TABLE "loop_events" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "runId" integer, "source" character varying(32) NOT NULL, "type" character varying(64) NOT NULL, "summary" character varying(500) NOT NULL, CONSTRAINT "PK_loop_events_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_loop_events_runId" ON "loop_events" ("runId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "loop_events" ADD CONSTRAINT "FK_loop_events_runId" FOREIGN KEY ("runId") REFERENCES "loop_runs"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loop_events" DROP CONSTRAINT "FK_loop_events_runId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_loop_events_runId"`);
    await queryRunner.query(`DROP TABLE "loop_events"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_loop_runs_prNumber"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_loop_runs_stage"`);
    await queryRunner.query(`DROP TABLE "loop_runs"`);
  }
}
