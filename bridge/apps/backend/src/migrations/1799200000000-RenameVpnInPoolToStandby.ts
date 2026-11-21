import { MigrationInterface, QueryRunner } from 'typeorm';

// «В пуле» became a COLD standby: the links of such a connection are not balanced with the active one's but kept behind it, used only while
// every link of the active connection is dead. The column is renamed to say so; the flags already set stay.
export class RenameVpnInPoolToStandby1799200000000 implements MigrationInterface {
  name = 'RenameVpnInPoolToStandby1799200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vpn_connections" RENAME COLUMN "inPool" TO "standby"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vpn_connections" RENAME COLUMN "standby" TO "inPool"`,
    );
  }
}
