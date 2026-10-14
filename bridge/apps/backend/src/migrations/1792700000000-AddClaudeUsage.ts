import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClaudeUsage1792700000000 implements MigrationInterface {
  name = 'AddClaudeUsage1792700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "jobs" ADD "usage" jsonb`);
    await queryRunner.query(
      `ALTER TABLE "claude_credentials" ADD "limits" jsonb`,
    );
    await queryRunner.query(`ALTER TABLE "workers" ADD "claudeLimits" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "workers" DROP COLUMN "claudeLimits"`);
    await queryRunner.query(
      `ALTER TABLE "claude_credentials" DROP COLUMN "limits"`,
    );
    await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "usage"`);
  }
}
