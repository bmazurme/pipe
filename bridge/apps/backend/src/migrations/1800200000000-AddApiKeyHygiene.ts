import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddApiKeyHygiene1800200000000 implements MigrationInterface {
  name = 'AddApiKeyHygiene1800200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "api_keys" ADD "notifiedExpiringAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "api_keys" ADD "notifiedStaleAt" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "api_keys" DROP COLUMN "notifiedStaleAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "api_keys" DROP COLUMN "notifiedExpiringAt"`,
    );
  }
}
