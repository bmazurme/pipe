import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChatMessagesPendingIndex1793200000000 implements MigrationInterface {
  name = 'AddChatMessagesPendingIndex1793200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_chat_messages_pending" ON "chat_messages" ("createdAt") WHERE status = 'pending'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_chat_messages_pending"`);
  }
}
