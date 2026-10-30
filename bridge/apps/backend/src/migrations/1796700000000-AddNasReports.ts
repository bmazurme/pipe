import { MigrationInterface, QueryRunner } from 'typeorm';

// What a NAS last told bridge about itself (RAID, SMART, the copy it keeps), for the Dashboard.
export class AddNasReports1796700000000 implements MigrationInterface {
  name = 'AddNasReports1796700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "nas_reports" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "host" character varying(100) NOT NULL, "reportedAt" TIMESTAMP NOT NULL, "data" jsonb NOT NULL, CONSTRAINT "PK_nas_reports_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_nas_reports_userId_host" ON "nas_reports" ("userId", "host")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_nas_reports_userId_host"`);
    await queryRunner.query(`DROP TABLE "nas_reports"`);
  }
}
