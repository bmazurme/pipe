import { MigrationInterface, QueryRunner } from 'typeorm';

// A worker follows the VPN page's ACTIVE connection unless its owner said otherwise. Until now the default was «own link», and an empty
// own link meant «no VPN»: such a worker silently ran on whatever proxy its container's environment named (a Swarm stack's static
// vpn-client), ignoring the connection that is active. Every worker that never stated a VPN of its own moves to «active»; a worker with
// its own link or a chosen connection keeps it. «No VPN on purpose» is now its own value ('none') and is set from the worker's settings.
export class DefaultWorkerVpnActive1798900000000 implements MigrationInterface {
  name = 'DefaultWorkerVpnActive1798900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workers" ALTER COLUMN "vpnSource" SET DEFAULT 'active'`,
    );
    await queryRunner.query(
      `UPDATE "workers" SET "vpnSource" = 'active' WHERE "vpnSource" = 'link' AND ("vpnLink" IS NULL OR "vpnLink" = '') AND "vpnConnectionId" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workers" ALTER COLUMN "vpnSource" SET DEFAULT 'link'`,
    );
    // Which workers were «link, no link» before cannot be told from the ones that chose «active», so none are moved back.
  }
}
