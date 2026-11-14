import { MigrationInterface, QueryRunner } from 'typeorm';

// Promo stage 2: the Telegram channel and group the posts go to, the chats the bot has been seen in (offered for binding), and the
// «announce in the group» switch on a post.
export class AddPromoTelegram1798700000000 implements MigrationInterface {
  name = 'AddPromoTelegram1798700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "telegram_chats" ("chatId" character varying(32) NOT NULL, "type" character varying(16) NOT NULL, "title" character varying(255), "username" character varying(64), "botStatus" character varying(16), "lastSeenAt" TIMESTAMP NOT NULL, CONSTRAINT "PK_telegram_chats_chatId" PRIMARY KEY ("chatId"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "promo_telegram_targets" ("role" character varying(16) NOT NULL, "chatId" character varying(32) NOT NULL, "title" character varying(255), "username" character varying(64), "boundAt" TIMESTAMP NOT NULL, CONSTRAINT "PK_promo_telegram_targets_role" PRIMARY KEY ("role"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "promo_posts" ADD "announceInGroup" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "promo_posts" DROP COLUMN "announceInGroup"`,
    );
    await queryRunner.query(`DROP TABLE "promo_telegram_targets"`);
    await queryRunner.query(`DROP TABLE "telegram_chats"`);
  }
}
