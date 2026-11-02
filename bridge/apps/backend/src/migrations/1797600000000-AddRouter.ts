import { MigrationInterface, QueryRunner } from 'typeorm';

// What the router last looked like to the agent (for the Dashboard), and the owner's requests to reboot it (the Telegram button).
export class AddRouter1797600000000 implements MigrationInterface {
  name = 'AddRouter1797600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "router_reports" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "host" character varying(100) NOT NULL, "reportedAt" TIMESTAMP NOT NULL, "data" jsonb NOT NULL, CONSTRAINT "PK_router_reports_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_router_reports_userId_host" ON "router_reports" ("userId", "host")`,
    );
    await queryRunner.query(
      `CREATE TABLE "router_reboots" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "host" character varying(100) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'pending', "takenAt" TIMESTAMP, "finishedAt" TIMESTAMP, "result" text, CONSTRAINT "PK_router_reboots_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_router_reboots_userId_host_status" ON "router_reboots" ("userId", "host", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_router_reboots_userId_host_status"`,
    );
    await queryRunner.query(`DROP TABLE "router_reboots"`);
    await queryRunner.query(`DROP INDEX "IDX_router_reports_userId_host"`);
    await queryRunner.query(`DROP TABLE "router_reports"`);
  }
}
