import { MigrationInterface, QueryRunner } from 'typeorm';

// Optional day a vault secret stops being valid; null for none.
export class AddSecretExpiresOn1795900000000 implements MigrationInterface {
  name = 'AddSecretExpiresOn1795900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "secrets" ADD "expiresOn" date`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "secrets" DROP COLUMN "expiresOn"`);
  }
}
