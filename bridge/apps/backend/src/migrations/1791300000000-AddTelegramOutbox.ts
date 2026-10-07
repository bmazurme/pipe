import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTelegramOutbox1791300000000 implements MigrationInterface {
  name = 'AddTelegramOutbox1791300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "telegram_outbox" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "text" text NOT NULL, "buttons" text, CONSTRAINT "PK_telegram_outbox_id" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "telegram_outbox"`);
  }
}
