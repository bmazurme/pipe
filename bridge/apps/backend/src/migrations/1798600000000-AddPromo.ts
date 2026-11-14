import { MigrationInterface, QueryRunner } from 'typeorm';

// The promo module: posts for the project's channels (Telegram, YouTube, Instagram), the pictures and videos they carry, and the
// uploaded versions of the landing page.
export class AddPromo1798600000000 implements MigrationInterface {
  name = 'AddPromo1798600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "promo_posts" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channel" character varying(16) NOT NULL, "title" character varying(200) NOT NULL, "textRu" text NOT NULL DEFAULT '', "textEn" text NOT NULL DEFAULT '', "assetIds" jsonb NOT NULL DEFAULT '[]', "mode" character varying(16) NOT NULL DEFAULT 'auto', "scheduledAt" TIMESTAMP, "status" character varying(16) NOT NULL DEFAULT 'draft', "externalUrl" character varying(500), "error" text, "publishedAt" TIMESTAMP, "utmCampaign" character varying(64), CONSTRAINT "PK_promo_posts_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_promo_posts_channel" ON "promo_posts" ("channel")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_promo_posts_scheduledAt" ON "promo_posts" ("scheduledAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_promo_posts_status" ON "promo_posts" ("status")`,
    );
    await queryRunner.query(
      `CREATE TABLE "promo_assets" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "originalName" character varying(255) NOT NULL, "mime" character varying(100) NOT NULL, "size" integer NOT NULL, "storedName" character varying(255) NOT NULL, CONSTRAINT "PK_promo_assets_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "promo_landing_releases" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "label" character varying(120) NOT NULL, "storedName" character varying(255) NOT NULL, "dirName" character varying(64) NOT NULL, "fileCount" integer NOT NULL, "sizeBytes" integer NOT NULL, "activatedAt" TIMESTAMP, CONSTRAINT "PK_promo_landing_releases_id" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "promo_landing_releases"`);
    await queryRunner.query(`DROP TABLE "promo_assets"`);
    await queryRunner.query(`DROP INDEX "IDX_promo_posts_status"`);
    await queryRunner.query(`DROP INDEX "IDX_promo_posts_scheduledAt"`);
    await queryRunner.query(`DROP INDEX "IDX_promo_posts_channel"`);
    await queryRunner.query(`DROP TABLE "promo_posts"`);
  }
}
