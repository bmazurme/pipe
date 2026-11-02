import { MigrationInterface, QueryRunner } from 'typeorm';

// Marks internal chats (the router's classifier) so the worker runs their turns without tools.
export class AddChatPurpose1797400000000 implements MigrationInterface {
  name = 'AddChatPurpose1797400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chats" ADD "purpose" character varying(32)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "chats" DROP COLUMN "purpose"`);
  }
}
