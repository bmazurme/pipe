import { MigrationInterface, QueryRunner } from 'typeorm';

// A board's update decision is either «install the scripts from main» or «update the worker container» — the same one-decision-at-a-time,
// expires-in-an-hour, the-agent-decides machinery, so the same table with a kind. Every existing row is a scripts decision.
export class AddScriptUpdateKind1799100000000 implements MigrationInterface {
  name = 'AddScriptUpdateKind1799100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "script_updates" ADD "kind" character varying(16) NOT NULL DEFAULT 'scripts'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "script_updates" DROP COLUMN "kind"`);
  }
}
