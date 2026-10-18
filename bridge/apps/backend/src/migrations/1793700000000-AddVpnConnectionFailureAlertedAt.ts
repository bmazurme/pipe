import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVpnConnectionFailureAlertedAt1793700000000 implements MigrationInterface {
  name = 'AddVpnConnectionFailureAlertedAt1793700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vpn_connections" ADD "failureAlertedAt" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vpn_connections" DROP COLUMN "failureAlertedAt"`,
    );
  }
}
