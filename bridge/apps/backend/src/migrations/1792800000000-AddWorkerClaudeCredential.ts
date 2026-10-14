import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkerClaudeCredential1792800000000 implements MigrationInterface {
  name = 'AddWorkerClaudeCredential1792800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workers" ADD "claudeCredentialId" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "workers" ADD CONSTRAINT "FK_workers_claudeCredentialId" FOREIGN KEY ("claudeCredentialId") REFERENCES "claude_credentials"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workers" DROP CONSTRAINT "FK_workers_claudeCredentialId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workers" DROP COLUMN "claudeCredentialId"`,
    );
  }
}
