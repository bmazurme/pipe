import { MigrationInterface, QueryRunner } from 'typeorm';

// Promo: visits to the landing page. One row per event (a page view, a click on an outgoing link, a video play) sent by the page's own
// small script; no cookies, no IP address, no user agent stored — `visitor` is a one-day pseudonym (see landing-hits.ts).
export class AddPromoLandingHits1798800000000 implements MigrationInterface {
  name = 'AddPromoLandingHits1798800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "promo_landing_hits" ("id" SERIAL NOT NULL, "at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "kind" character varying(8) NOT NULL, "visitor" character varying(16) NOT NULL, "device" character varying(8) NOT NULL, "lang" character varying(2), "referrer" character varying(80), "utmSource" character varying(80), "utmMedium" character varying(80), "utmCampaign" character varying(80), "target" character varying(80), "section" character varying(40), CONSTRAINT "PK_promo_landing_hits_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_promo_landing_hits_at" ON "promo_landing_hits" ("at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_promo_landing_hits_at"`);
    await queryRunner.query(`DROP TABLE "promo_landing_hits"`);
  }
}
