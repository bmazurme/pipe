import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTimeReportEntries1787127151229 implements MigrationInterface {
  name = 'AddTimeReportEntries1787127151229';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "time_report_entries" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "year" integer NOT NULL, "month" integer NOT NULL, "taskName" character varying(500) NOT NULL, "status" character varying(100) NOT NULL, "hours" numeric(6,2) NOT NULL, CONSTRAINT "PK_995a518ad6f3bd214b329d6f608" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_df834caf128be03ecfd8ec5f3f" ON "time_report_entries" ("userId", "year", "month") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_df834caf128be03ecfd8ec5f3f"`,
    );
    await queryRunner.query(`DROP TABLE "time_report_entries"`);
  }
}
