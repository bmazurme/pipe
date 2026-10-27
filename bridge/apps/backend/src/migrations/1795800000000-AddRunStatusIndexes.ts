import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRunStatusIndexes1795800000000 implements MigrationInterface {
  name = 'AddRunStatusIndexes1795800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_lab_runs_status" ON "lab_runs" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_lab_runs_userId_projectId_id" ON "lab_runs" ("userId", "projectId", "id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_improve_runs_status" ON "improve_runs" ("status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_improve_runs_status"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_lab_runs_userId_projectId_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_lab_runs_status"`);
  }
}
