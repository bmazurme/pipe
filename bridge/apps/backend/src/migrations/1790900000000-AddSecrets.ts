import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSecrets1790900000000 implements MigrationInterface {
  name = 'AddSecrets1790900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "secrets" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "name" character varying(255) NOT NULL, "description" character varying(500), "value" text NOT NULL, CONSTRAINT "PK_secrets_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_secrets_userId" ON "secrets" ("userId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_secrets_userId_name" ON "secrets" ("userId", "name")`,
    );
    await queryRunner.query(
      `ALTER TABLE "secrets" ADD CONSTRAINT "FK_secrets_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "secrets" DROP CONSTRAINT "FK_secrets_userId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_secrets_userId_name"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_secrets_userId"`);
    await queryRunner.query(`DROP TABLE "secrets"`);
  }
}
