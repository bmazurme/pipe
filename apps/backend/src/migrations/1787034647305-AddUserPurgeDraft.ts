import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserPurgeDraft1787034647305 implements MigrationInterface {
  name = 'AddUserPurgeDraft1787034647305';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "purgeDraft" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "purgeDraft"`);
  }
}
