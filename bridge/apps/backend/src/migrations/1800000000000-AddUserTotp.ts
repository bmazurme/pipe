import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserTotp1800000000000 implements MigrationInterface {
  name = 'AddUserTotp1800000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "user_totp" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "secret" text NOT NULL, "enabledAt" TIMESTAMP, "lastStep" bigint NOT NULL DEFAULT '0', CONSTRAINT "PK_user_totp_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_user_totp_userId" ON "user_totp" ("userId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_totp" ADD CONSTRAINT "FK_user_totp_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE TABLE "recovery_codes" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "codeHash" character varying(64) NOT NULL, "usedAt" TIMESTAMP, CONSTRAINT "PK_recovery_codes_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_recovery_codes_userId" ON "recovery_codes" ("userId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_recovery_codes_codeHash" ON "recovery_codes" ("codeHash")`,
    );
    await queryRunner.query(
      `ALTER TABLE "recovery_codes" ADD CONSTRAINT "FK_recovery_codes_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "recovery_codes" DROP CONSTRAINT "FK_recovery_codes_userId"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_recovery_codes_codeHash"`);
    await queryRunner.query(`DROP INDEX "IDX_recovery_codes_userId"`);
    await queryRunner.query(`DROP TABLE "recovery_codes"`);
    await queryRunner.query(
      `ALTER TABLE "user_totp" DROP CONSTRAINT "FK_user_totp_userId"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_user_totp_userId"`);
    await queryRunner.query(`DROP TABLE "user_totp"`);
  }
}
