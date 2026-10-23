import { MigrationInterface, QueryRunner } from 'typeorm';

// A nullable scope on API keys: null is a full key, 'boards' is accepted only by the boards' agent routes.
export class AddApiKeyScope1795000000000 implements MigrationInterface {
  name = 'AddApiKeyScope1795000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "api_keys" ADD "scope" character varying(16)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "api_keys" DROP COLUMN "scope"`);
  }
}
