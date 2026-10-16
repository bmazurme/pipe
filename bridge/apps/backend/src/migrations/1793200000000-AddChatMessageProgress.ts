import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChatMessageProgress1793200000000 implements MigrationInterface {
  name = 'AddChatMessageProgress1793200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "chat_messages" ADD "progress" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chat_messages" DROP COLUMN "progress"`,
    );
  }
}
