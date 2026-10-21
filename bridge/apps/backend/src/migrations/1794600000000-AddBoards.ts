import { MigrationInterface, QueryRunner } from 'typeorm';

// What each board reports about its installed scripts, and the owner's decisions to update them.
export class AddBoards1794600000000 implements MigrationInterface {
  name = 'AddBoards1794600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "board_reports" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "host" character varying(100) NOT NULL, "reportedAt" TIMESTAMP NOT NULL, "mainSha" character varying(40) NOT NULL, "agentVersion" character varying(32), "scripts" jsonb NOT NULL, "announcedKey" character varying(64), CONSTRAINT "PK_board_reports_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_board_reports_userId_host" ON "board_reports" ("userId", "host")`,
    );
    await queryRunner.query(
      `CREATE TABLE "script_updates" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "host" character varying(100) NOT NULL, "sha" character varying(40) NOT NULL, "repoPaths" jsonb NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'pending', "via" character varying(16) NOT NULL, "result" text, "finishedAt" TIMESTAMP, CONSTRAINT "PK_script_updates_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_script_updates_userId_host_status" ON "script_updates" ("userId", "host", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_script_updates_userId_host_status"`,
    );
    await queryRunner.query(`DROP TABLE "script_updates"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_board_reports_userId_host"`,
    );
    await queryRunner.query(`DROP TABLE "board_reports"`);
  }
}
