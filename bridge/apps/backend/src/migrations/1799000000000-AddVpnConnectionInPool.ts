import { MigrationInterface, QueryRunner } from 'typeorm';

// A VPN connection can be marked «in the pool»: its links join the active connection's in the tunnel of bridge and of the workers that
// follow the active connection, so a dead link is replaced by a live one without anybody pressing «make active». Nothing is in the pool
// until its owner says so.
export class AddVpnConnectionInPool1799000000000 implements MigrationInterface {
  name = 'AddVpnConnectionInPool1799000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vpn_connections" ADD "inPool" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vpn_connections" DROP COLUMN "inPool"`,
    );
  }
}
