import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChatContext1793600000000 implements MigrationInterface {
  name = 'AddChatContext1793600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chats" ADD "contextName" character varying(255)`,
    );
    await queryRunner.query(`ALTER TABLE "chats" ADD "contextText" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "chats" DROP COLUMN "contextText"`);
    await queryRunner.query(`ALTER TABLE "chats" DROP COLUMN "contextName"`);
  }
}
