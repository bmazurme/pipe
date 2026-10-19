import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAppLogsCreatedAtIndex1793800000000 implements MigrationInterface {
  name = 'AddAppLogsCreatedAtIndex1793800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_app_logs_createdAt" ON "app_logs" ("createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_app_logs_createdAt"`);
  }
}
