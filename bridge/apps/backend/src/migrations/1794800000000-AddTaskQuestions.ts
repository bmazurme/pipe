import { MigrationInterface, QueryRunner } from 'typeorm';

// Open questions workers find in a run's output, grouped into cards per task in the UI.
export class AddTaskQuestions1794800000000 implements MigrationInterface {
  name = 'AddTaskQuestions1794800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "task_questions" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "jobId" integer, "taskKey" character varying(100) NOT NULL, "project" character varying(50), "text" character varying(500) NOT NULL, "resolvedAt" TIMESTAMP, CONSTRAINT "PK_task_questions_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_task_questions_userId_taskKey" ON "task_questions" ("userId", "taskKey")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_task_questions_userId_taskKey"`,
    );
    await queryRunner.query(`DROP TABLE "task_questions"`);
  }
}
