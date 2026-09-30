import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkerJobs1790100000000 implements MigrationInterface {
  name = 'AddWorkerJobs1790100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."jobs_model_enum" AS ENUM('sonnet', 'opus', 'gpt', 'deepseek', 'qwen')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."jobs_status_enum" AS ENUM('queued', 'claimed', 'running', 'succeeded', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "jobs" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "sourceFileId" integer NOT NULL, "resultFileId" integer, "model" "public"."jobs_model_enum" NOT NULL, "status" "public"."jobs_status_enum" NOT NULL DEFAULT 'queued', "logs" text NOT NULL DEFAULT '', "errorMessage" text, "workerName" character varying(255), "claimedAt" TIMESTAMP, "startedAt" TIMESTAMP, "finishedAt" TIMESTAMP, CONSTRAINT "PK_jobs_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_jobs_userId_status" ON "jobs" ("userId", "status") `,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" ADD CONSTRAINT "FK_jobs_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" ADD CONSTRAINT "FK_jobs_sourceFileId" FOREIGN KEY ("sourceFileId") REFERENCES "stored_files"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" ADD CONSTRAINT "FK_jobs_resultFileId" FOREIGN KEY ("resultFileId") REFERENCES "stored_files"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "jobs" DROP CONSTRAINT "FK_jobs_resultFileId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" DROP CONSTRAINT "FK_jobs_sourceFileId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" DROP CONSTRAINT "FK_jobs_userId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_jobs_userId_status"`);
    await queryRunner.query(`DROP TABLE "jobs"`);
    await queryRunner.query(`DROP TYPE "public"."jobs_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."jobs_model_enum"`);
  }
}
