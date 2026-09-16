import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddApiKeys1789587965450 implements MigrationInterface {
  name = 'AddApiKeys1789587965450';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "api_keys" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "name" character varying(255) NOT NULL, "prefix" character varying(16) NOT NULL, "keyHash" character varying(255) NOT NULL, "lastUsedAt" TIMESTAMP, "revokedAt" TIMESTAMP, CONSTRAINT "PK_5c8a79801b44bd27b79228e1dad" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6c2e267ae764a9413b863a2934" ON "api_keys" ("userId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_df3b25181df0b4b59bd93f16e1" ON "api_keys" ("keyHash") `,
    );
    await queryRunner.query(
      `ALTER TABLE "api_keys" ADD CONSTRAINT "FK_6c2e267ae764a9413b863a29342" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "api_keys" DROP CONSTRAINT "FK_6c2e267ae764a9413b863a29342"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_df3b25181df0b4b59bd93f16e1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6c2e267ae764a9413b863a2934"`,
    );
    await queryRunner.query(`DROP TABLE "api_keys"`);
  }
}
