import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChats1790200000000 implements MigrationInterface {
  name = 'AddChats1790200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."chats_model_enum" AS ENUM('sonnet', 'opus', 'gpt', 'deepseek', 'qwen')`,
    );
    await queryRunner.query(
      `CREATE TABLE "chats" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "model" "public"."chats_model_enum" NOT NULL, "title" character varying(255), CONSTRAINT "PK_chats_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_chats_userId" ON "chats" ("userId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "chats" ADD CONSTRAINT "FK_chats_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."chat_messages_role_enum" AS ENUM('user', 'assistant')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."chat_messages_status_enum" AS ENUM('pending', 'running', 'complete', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "chat_messages" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "chatId" integer NOT NULL, "role" "public"."chat_messages_role_enum" NOT NULL, "content" text NOT NULL DEFAULT '', "status" "public"."chat_messages_status_enum" NOT NULL DEFAULT 'complete', "errorMessage" text, CONSTRAINT "PK_chat_messages_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_chat_messages_chatId" ON "chat_messages" ("chatId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_messages" ADD CONSTRAINT "FK_chat_messages_chatId" FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chat_messages" DROP CONSTRAINT "FK_chat_messages_chatId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_chat_messages_chatId"`);
    await queryRunner.query(`DROP TABLE "chat_messages"`);
    await queryRunner.query(`DROP TYPE "public"."chat_messages_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."chat_messages_role_enum"`);

    await queryRunner.query(
      `ALTER TABLE "chats" DROP CONSTRAINT "FK_chats_userId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_chats_userId"`);
    await queryRunner.query(`DROP TABLE "chats"`);
    await queryRunner.query(`DROP TYPE "public"."chats_model_enum"`);
  }
}
