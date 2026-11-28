import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKeyRotation1800400000000 implements MigrationInterface {
  name = 'AddKeyRotation1800400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "rotation_items" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "key" character varying(40) NOT NULL, "lastRotatedAt" TIMESTAMP, "notifiedAt" TIMESTAMP, CONSTRAINT "PK_rotation_items_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_rotation_items_userId_key" ON "rotation_items" ("userId", "key")`,
    );
    await queryRunner.query(
      `CREATE TABLE "key_copy_checks" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "label" character varying(40) NOT NULL, "lastCheckAt" TIMESTAMP NOT NULL, "ok" boolean NOT NULL, "lastOkAt" TIMESTAMP, "backupCreatedAt" character varying(40), "error" character varying(500), CONSTRAINT "PK_key_copy_checks_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_key_copy_checks_userId_label" ON "key_copy_checks" ("userId", "label")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_key_copy_checks_userId_label"`);
    await queryRunner.query(`DROP TABLE "key_copy_checks"`);
    await queryRunner.query(`DROP INDEX "IDX_rotation_items_userId_key"`);
    await queryRunner.query(`DROP TABLE "rotation_items"`);
  }
}
