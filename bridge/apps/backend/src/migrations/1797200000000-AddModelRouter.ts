import { MigrationInterface, QueryRunner } from 'typeorm';

// The model router: its settings per owner, and what it decided on each Lab run ("why this model").
export class AddModelRouter1797200000000 implements MigrationInterface {
  name = 'AddModelRouter1797200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "router_settings" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "tierModels" jsonb NOT NULL, "rules" jsonb NOT NULL, CONSTRAINT "PK_router_settings_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_router_settings_userId" ON "router_settings" ("userId")`,
    );
    await queryRunner.query(`ALTER TABLE "lab_runs" ADD "routing" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lab_runs" DROP COLUMN "routing"`);
    await queryRunner.query(`DROP INDEX "IDX_router_settings_userId"`);
    await queryRunner.query(`DROP TABLE "router_settings"`);
  }
}
