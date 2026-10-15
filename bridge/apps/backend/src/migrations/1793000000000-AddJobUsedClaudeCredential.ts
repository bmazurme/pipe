import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddJobUsedClaudeCredential1793000000000 implements MigrationInterface {
  name = 'AddJobUsedClaudeCredential1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "jobs" ADD "usedClaudeCredentialId" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" ADD "usedClaudeCredentialName" character varying(255)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "jobs" DROP COLUMN "usedClaudeCredentialName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" DROP COLUMN "usedClaudeCredentialId"`,
    );
  }
}
