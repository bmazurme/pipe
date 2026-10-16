import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLimitAlertStates1793300000000 implements MigrationInterface {
  name = 'AddLimitAlertStates1793300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "limit_alert_states" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "ownerKey" character varying(100) NOT NULL, "windows" jsonb NOT NULL, CONSTRAINT "PK_limit_alert_states_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_limit_alert_states_ownerKey" ON "limit_alert_states" ("ownerKey")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_limit_alert_states_ownerKey"`);
    await queryRunner.query(`DROP TABLE "limit_alert_states"`);
  }
}
