import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClientHeartbeats1791100000000 implements MigrationInterface {
  name = 'AddClientHeartbeats1791100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "client_heartbeats" ("userId" integer NOT NULL, "name" character varying(255) NOT NULL, "kind" character varying(32) NOT NULL, "lastSeenAt" TIMESTAMP NOT NULL, "isUp" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_client_heartbeats" PRIMARY KEY ("userId", "name"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "client_heartbeats"`);
  }
}
