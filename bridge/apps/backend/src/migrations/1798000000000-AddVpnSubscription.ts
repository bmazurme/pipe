import { MigrationInterface, QueryRunner } from 'typeorm';

// A VPN connection can be a subscription link (an https address that answers with vless:// links) instead of an x-ui panel.
export class AddVpnSubscription1798000000000 implements MigrationInterface {
  name = 'AddVpnSubscription1798000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vpn_connections" ADD "kind" character varying(20) NOT NULL DEFAULT 'panel'`,
    );
    await queryRunner.query(
      `ALTER TABLE "vpn_connections" ADD "subscriptionUrl" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vpn_connections" DROP COLUMN "subscriptionUrl"`,
    );
    await queryRunner.query(`ALTER TABLE "vpn_connections" DROP COLUMN "kind"`);
  }
}
