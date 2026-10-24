import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddJobUserUpdatedAtIndex1795400000000 implements MigrationInterface {
  name = 'AddJobUserUpdatedAtIndex1795400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_jobs_userId_updatedAt" ON "jobs" ("userId", "updatedAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_jobs_userId_updatedAt"`);
  }
}
