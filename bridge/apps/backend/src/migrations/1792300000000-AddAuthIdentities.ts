import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuthIdentities1792300000000 implements MigrationInterface {
  name = 'AddAuthIdentities1792300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "auth_identities" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "provider" character varying(16) NOT NULL, "providerUserId" character varying(255) NOT NULL, "email" character varying(255), "enabled" boolean NOT NULL DEFAULT true, "lastUsedAt" TIMESTAMP, CONSTRAINT "PK_auth_identities_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_auth_identities_provider_providerUserId" ON "auth_identities" ("provider", "providerUserId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_auth_identities_userId_provider" ON "auth_identities" ("userId", "provider")`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_identities" ADD CONSTRAINT "FK_auth_identities_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    // Every existing user signed in through Yandex, and only the email was stored — not
    // Yandex's account id. 'legacy:<email>' keeps their sign-in working; the first Yandex
    // login after this swaps it for the real id (IdentitiesService.resolveLogin).
    await queryRunner.query(
      `INSERT INTO "auth_identities" ("userId", "provider", "providerUserId", "email", "enabled") SELECT "id", 'yandex', 'legacy:' || "email", "email", true FROM "users"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth_identities" DROP CONSTRAINT "FK_auth_identities_userId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_auth_identities_userId_provider"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_auth_identities_provider_providerUserId"`,
    );
    await queryRunner.query(`DROP TABLE "auth_identities"`);
  }
}
