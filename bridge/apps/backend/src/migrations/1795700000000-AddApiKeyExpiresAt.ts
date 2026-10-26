import { MigrationInterface, QueryRunner } from 'typeorm';

// A personal API key can expire on its own; null keeps existing keys valid until revoked.
export class AddApiKeyExpiresAt1795700000000 implements MigrationInterface {
  name = 'AddApiKeyExpiresAt1795700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "api_keys" ADD "expiresAt" TIMESTAMP`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "api_keys" DROP COLUMN "expiresAt"`);
  }
}
