import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddImproveOutcomes1799400000000 implements MigrationInterface {
  name = 'AddImproveOutcomes1799400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "improve_outcomes" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "prNumber" integer NOT NULL, "runId" integer NOT NULL, "model" character varying(16) NOT NULL, "tier" smallint, "state" character varying(8) NOT NULL DEFAULT 'open', "firstCi" character varying(8), "ciRepairs" smallint NOT NULL DEFAULT '0', "costUsd" double precision, "openedAt" TIMESTAMP NOT NULL, "mergedAt" TIMESTAMP, "closedAt" TIMESTAMP, "reverted" boolean NOT NULL DEFAULT false, "checkedAt" TIMESTAMP NOT NULL, CONSTRAINT "PK_improve_outcomes_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_improve_outcomes_userId_prNumber" ON "improve_outcomes" ("userId", "prNumber")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "improve_outcomes"`);
  }
}
