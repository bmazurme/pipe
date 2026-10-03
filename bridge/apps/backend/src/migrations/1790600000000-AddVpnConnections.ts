import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVpnConnections1790600000000 implements MigrationInterface {
  name = 'AddVpnConnections1790600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "vpn_connections" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "name" character varying(255) NOT NULL, "panelUrl" text NOT NULL, "panelApiToken" text NOT NULL, "serverAddress" character varying(255) NOT NULL, "isActive" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_vpn_connections_id" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "vpn_connections"`);
  }
}
