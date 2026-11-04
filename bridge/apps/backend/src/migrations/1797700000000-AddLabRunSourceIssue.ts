import { MigrationInterface, QueryRunner } from 'typeorm';

// The issue a Lab run was started from («Из issue»); older runs keep null.
export class AddLabRunSourceIssue1797700000000 implements MigrationInterface {
  name = 'AddLabRunSourceIssue1797700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lab_runs" ADD "sourceIssueNumber" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lab_runs" DROP COLUMN "sourceIssueNumber"`,
    );
  }
}
