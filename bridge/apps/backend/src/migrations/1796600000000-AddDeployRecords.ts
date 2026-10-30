import { MigrationInterface, QueryRunner } from 'typeorm';

// What the deploying board reports about each release (deployed / rolled back / failed), with the pull requests in it.
export class AddDeployRecords1796600000000 implements MigrationInterface {
  name = 'AddDeployRecords1796600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "deploy_records" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "sha" character varying(40) NOT NULL, "previousSha" character varying(40), "result" character varying(16) NOT NULL, "detail" character varying(500), "prNumbers" jsonb NOT NULL DEFAULT '[]', CONSTRAINT "PK_deploy_records_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_deploy_records_sha_result" ON "deploy_records" ("sha", "result")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_deploy_records_sha_result"`);
    await queryRunner.query(`DROP TABLE "deploy_records"`);
  }
}
