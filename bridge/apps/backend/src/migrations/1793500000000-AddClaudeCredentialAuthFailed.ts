import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClaudeCredentialAuthFailed1793500000000 implements MigrationInterface {
  name = 'AddClaudeCredentialAuthFailed1793500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "claude_credentials" ADD "authFailedAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "claude_credentials" ADD "authFailedJobId" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "claude_credentials" DROP COLUMN "authFailedJobId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "claude_credentials" DROP COLUMN "authFailedAt"`,
    );
  }
}
