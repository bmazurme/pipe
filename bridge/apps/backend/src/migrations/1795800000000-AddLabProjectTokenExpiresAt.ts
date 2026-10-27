import { MigrationInterface, QueryRunner } from 'typeorm';

// When a Lab project's GitHub token expires, as GitHub reports it; null for a token without expiry or not yet checked.
export class AddLabProjectTokenExpiresAt1795800000000 implements MigrationInterface {
  name = 'AddLabProjectTokenExpiresAt1795800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lab_projects" ADD "tokenExpiresAt" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lab_projects" DROP COLUMN "tokenExpiresAt"`,
    );
  }
}
