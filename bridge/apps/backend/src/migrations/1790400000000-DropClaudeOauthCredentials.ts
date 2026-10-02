import { MigrationInterface, QueryRunner } from 'typeorm';

// Reverts 1790300000000-AddClaudeOauthCredentials: Anthropic's OAuth token
// endpoint turned out to reject this refresh flow from a server context
// entirely ("forbidden: Request not allowed"), not just from a bad/expired
// token — no amount of fixing the request shape gets past that, so the
// whole self-refreshing-credential approach (and the usage widget it
// powered) is removed rather than left half-working.
export class DropClaudeOauthCredentials1790400000000 implements MigrationInterface {
  name = 'DropClaudeOauthCredentials1790400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "claude_oauth_credentials"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "claude_oauth_credentials" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "accessToken" text NOT NULL, "refreshToken" text NOT NULL, "expiresAt" TIMESTAMP NOT NULL, CONSTRAINT "PK_claude_oauth_credentials_id" PRIMARY KEY ("id"))`,
    );
  }
}
