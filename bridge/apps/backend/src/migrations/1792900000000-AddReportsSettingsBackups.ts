import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReportsSettingsBackups1792900000000 implements MigrationInterface {
  name = 'AddReportsSettingsBackups1792900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "reports_settings_backups" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "payload" text NOT NULL, CONSTRAINT "PK_2d0d355b163c573eef55f510df9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_8e86b80548ad9d737579f6a176" ON "reports_settings_backups" ("userId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "reports_settings_backups" ADD CONSTRAINT "FK_8e86b80548ad9d737579f6a1763" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reports_settings_backups" DROP CONSTRAINT "FK_8e86b80548ad9d737579f6a1763"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8e86b80548ad9d737579f6a176"`,
    );
    await queryRunner.query(`DROP TABLE "reports_settings_backups"`);
  }
}
