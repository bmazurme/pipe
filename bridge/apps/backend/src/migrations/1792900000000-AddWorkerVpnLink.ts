import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkerVpnLink1792900000000 implements MigrationInterface {
  name = 'AddWorkerVpnLink1792900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "workers" ADD "vpnLink" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "workers" DROP COLUMN "vpnLink"`);
  }
}
