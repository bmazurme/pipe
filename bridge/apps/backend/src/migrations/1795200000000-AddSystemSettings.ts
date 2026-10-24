import { MigrationInterface, QueryRunner } from 'typeorm';

// Settings of the whole installation, edited by the owner from the Dashboard (first one: the proxy for the calls to GitHub).
export class AddSystemSettings1795200000000 implements MigrationInterface {
  name = 'AddSystemSettings1795200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "system_settings" ("id" integer NOT NULL, "githubProxyEnabled" boolean, "githubProxyUrl" character varying(500), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_system_settings_id" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "system_settings"`);
  }
}
