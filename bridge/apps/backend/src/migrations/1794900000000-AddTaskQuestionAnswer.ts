import { MigrationInterface, QueryRunner } from 'typeorm';

// The user's written answer to an open question.
export class AddTaskQuestionAnswer1794900000000 implements MigrationInterface {
  name = 'AddTaskQuestionAnswer1794900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "task_questions" ADD "answer" character varying(2000)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "task_questions" DROP COLUMN "answer"`,
    );
  }
}
