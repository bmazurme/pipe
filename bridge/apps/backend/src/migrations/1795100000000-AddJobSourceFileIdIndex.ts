import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddJobSourceFileIdIndex1795100000000 implements MigrationInterface {
  name = 'AddJobSourceFileIdIndex1795100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_jobs_sourceFileId" ON "jobs" ("sourceFileId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_jobs_sourceFileId"`);
  }
}
