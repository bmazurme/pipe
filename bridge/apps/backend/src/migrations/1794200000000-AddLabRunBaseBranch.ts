import { MigrationInterface, QueryRunner } from 'typeorm';

// A Lab run can target a branch other than its project's; older runs keep null and still use the project's.
export class AddLabRunBaseBranch1794200000000 implements MigrationInterface {
  name = 'AddLabRunBaseBranch1794200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lab_runs" ADD "baseBranch" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lab_runs" DROP COLUMN "baseBranch"`);
  }
}
