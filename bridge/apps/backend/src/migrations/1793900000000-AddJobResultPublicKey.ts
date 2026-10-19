import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddJobResultPublicKey1793900000000 implements MigrationInterface {
  name = 'AddJobResultPublicKey1793900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "jobs" ADD "resultPublicKey" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "resultPublicKey"`);
  }
}
