import { MigrationInterface, QueryRunner } from 'typeorm';

// What a UPS last told bridge about itself (status, charge, load, runtime), for the Dashboard.
export class AddUpsReports1797500000000 implements MigrationInterface {
  name = 'AddUpsReports1797500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ups_reports" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "host" character varying(100) NOT NULL, "reportedAt" TIMESTAMP NOT NULL, "data" jsonb NOT NULL, CONSTRAINT "PK_ups_reports_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ups_reports_userId_host" ON "ups_reports" ("userId", "host")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_ups_reports_userId_host"`);
    await queryRunner.query(`DROP TABLE "ups_reports"`);
  }
}
