import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClaudeCredentials1790500000000 implements MigrationInterface {
  name = 'AddClaudeCredentials1790500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "claude_credentials" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "name" character varying(255) NOT NULL, "token" text NOT NULL, CONSTRAINT "PK_claude_credentials_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_claude_credentials_userId" ON "claude_credentials" ("userId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "claude_credentials" ADD CONSTRAINT "FK_claude_credentials_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "jobs" ADD COLUMN "claudeCredentialId" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" ADD CONSTRAINT "FK_jobs_claudeCredentialId" FOREIGN KEY ("claudeCredentialId") REFERENCES "claude_credentials"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "jobs" DROP CONSTRAINT "FK_jobs_claudeCredentialId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" DROP COLUMN "claudeCredentialId"`,
    );

    await queryRunner.query(
      `ALTER TABLE "claude_credentials" DROP CONSTRAINT "FK_claude_credentials_userId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_claude_credentials_userId"`,
    );
    await queryRunner.query(`DROP TABLE "claude_credentials"`);
  }
}
