import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChatMessageReasoning1794300000000 implements MigrationInterface {
  name = 'AddChatMessageReasoning1794300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "chat_messages" ADD "reasoning" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chat_messages" DROP COLUMN "reasoning"`,
    );
  }
}
