import { MigrationInterface, QueryRunner } from 'typeorm';

// What the cloud VM last told bridge about itself (memory, disk, its services, replica lag, backups), for the Dashboard's «Облако» tile.
export class AddCloudReports1797900000000 implements MigrationInterface {
  name = 'AddCloudReports1797900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "cloud_reports" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "host" character varying(100) NOT NULL, "reportedAt" TIMESTAMP NOT NULL, "data" jsonb NOT NULL, CONSTRAINT "PK_cloud_reports_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_cloud_reports_userId_host" ON "cloud_reports" ("userId", "host")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_cloud_reports_userId_host"`);
    await queryRunner.query(`DROP TABLE "cloud_reports"`);
  }
}
