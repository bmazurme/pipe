import { MigrationInterface, QueryRunner } from 'typeorm';

// The latest probe of each VPN channel from each vantage point, for the Dashboard's «Каналы» tile.
export class AddLinkProbes1798200000000 implements MigrationInterface {
  name = 'AddLinkProbes1798200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "link_probes" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "vantage" character varying(100) NOT NULL, "channelKey" character varying(255) NOT NULL, "result" character varying(20) NOT NULL, "tcpMs" integer, "tlsMs" integer, "detail" character varying(200), "probedAt" TIMESTAMP NOT NULL, "changedAt" TIMESTAMP NOT NULL, CONSTRAINT "PK_link_probes_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_link_probes_vantage_channelKey" ON "link_probes" ("vantage", "channelKey")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_link_probes_vantage_channelKey"`);
    await queryRunner.query(`DROP TABLE "link_probes"`);
  }
}
