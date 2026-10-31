import { MigrationInterface, QueryRunner } from 'typeorm';

// A chat can run on 'custom' too: any OpenAI-compatible server, named by the stored key the chat points at.
export class AddChatCustomModel1797100000000 implements MigrationInterface {
  name = 'AddChatCustomModel1797100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ALTER TYPE … ADD VALUE is allowed inside a transaction since PostgreSQL 12; the new value just cannot be used before commit.
    await queryRunner.query(
      `ALTER TYPE "public"."chats_model_enum" ADD VALUE IF NOT EXISTS 'custom'`,
    );
    await queryRunner.query(
      `ALTER TABLE "chats" ADD "providerCredentialId" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "chats" ADD CONSTRAINT "FK_chats_providerCredentialId" FOREIGN KEY ("providerCredentialId") REFERENCES "provider_credentials"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chats" DROP CONSTRAINT "FK_chats_providerCredentialId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chats" DROP COLUMN "providerCredentialId"`,
    );
    // A value cannot be dropped from an enum: custom chats go, and the type is rebuilt without it.
    await queryRunner.query(`DELETE FROM "chats" WHERE "model" = 'custom'`);
    await queryRunner.query(
      `ALTER TYPE "public"."chats_model_enum" RENAME TO "chats_model_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."chats_model_enum" AS ENUM('sonnet', 'opus', 'haiku', 'gpt', 'deepseek', 'qwen')`,
    );
    await queryRunner.query(
      `ALTER TABLE "chats" ALTER COLUMN "model" TYPE "public"."chats_model_enum" USING "model"::"text"::"public"."chats_model_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."chats_model_enum_old"`);
  }
}
