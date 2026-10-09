import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChatAttachments1792200000000 implements MigrationInterface {
  name = 'AddChatAttachments1792200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "chat_attachments" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "chatId" integer NOT NULL, "userId" integer NOT NULL, "messageId" integer, "originalName" character varying(255) NOT NULL, "storedName" character varying(255) NOT NULL, "size" integer NOT NULL, CONSTRAINT "PK_chat_attachments_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_chat_attachments_chatId" ON "chat_attachments" ("chatId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_chat_attachments_messageId" ON "chat_attachments" ("messageId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_attachments" ADD CONSTRAINT "FK_chat_attachments_chatId" FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chat_attachments" DROP CONSTRAINT "FK_chat_attachments_chatId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_chat_attachments_messageId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_chat_attachments_chatId"`,
    );
    await queryRunner.query(`DROP TABLE "chat_attachments"`);
  }
}
