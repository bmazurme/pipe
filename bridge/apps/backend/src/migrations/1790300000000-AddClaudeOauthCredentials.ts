import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClaudeOauthCredentials1790300000000 implements MigrationInterface {
  name = 'AddClaudeOauthCredentials1790300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "claude_oauth_credentials" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "accessToken" text NOT NULL, "refreshToken" text NOT NULL, "expiresAt" TIMESTAMP NOT NULL, CONSTRAINT "PK_claude_oauth_credentials_id" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "claude_oauth_credentials"`);
  }
}
