import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLabRunIssue1794700000000 implements MigrationInterface {
  name = 'AddLabRunIssue1794700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lab_runs" ADD "issueNumber" integer`);
    await queryRunner.query(
      `ALTER TABLE "lab_runs" ADD "issueUrl" character varying(255)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lab_runs" DROP COLUMN "issueUrl"`);
    await queryRunner.query(`ALTER TABLE "lab_runs" DROP COLUMN "issueNumber"`);
  }
}
