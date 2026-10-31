import { MigrationInterface, QueryRunner } from 'typeorm';

// Where a worker's VPN comes from: its own pasted link (the default, what every existing worker has), a specific connection of the
// VPN page, or whichever connection is active there.
export class AddWorkerVpnSource1796900000000 implements MigrationInterface {
  name = 'AddWorkerVpnSource1796900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workers" ADD "vpnSource" character varying(16) NOT NULL DEFAULT 'link'`,
    );
    await queryRunner.query(
      `ALTER TABLE "workers" ADD "vpnConnectionId" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "workers" ADD CONSTRAINT "FK_workers_vpnConnectionId" FOREIGN KEY ("vpnConnectionId") REFERENCES "vpn_connections"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workers" DROP CONSTRAINT "FK_workers_vpnConnectionId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workers" DROP COLUMN "vpnConnectionId"`,
    );
    await queryRunner.query(`ALTER TABLE "workers" DROP COLUMN "vpnSource"`);
  }
}
