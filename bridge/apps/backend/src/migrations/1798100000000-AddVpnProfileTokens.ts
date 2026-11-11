import { MigrationInterface, QueryRunner } from 'typeorm';

// One token per device for fetching the VPN profile (a subscription of links) from bridge.
export class AddVpnProfileTokens1798100000000 implements MigrationInterface {
  name = 'AddVpnProfileTokens1798100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "vpn_profile_tokens" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "label" character varying(100) NOT NULL, "audience" character varying(20) NOT NULL, "tokenHash" character varying(64) NOT NULL, "tokenPrefix" character varying(16) NOT NULL, "lastUsedAt" TIMESTAMP, "revokedAt" TIMESTAMP, CONSTRAINT "PK_vpn_profile_tokens_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_vpn_profile_tokens_tokenHash" ON "vpn_profile_tokens" ("tokenHash")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_vpn_profile_tokens_tokenHash"`);
    await queryRunner.query(`DROP TABLE "vpn_profile_tokens"`);
  }
}
