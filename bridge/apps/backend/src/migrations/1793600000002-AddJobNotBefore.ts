import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddJobNotBefore1793600000002 implements MigrationInterface {
  name = 'AddJobNotBefore1793600000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "jobs" ADD "notBefore" TIMESTAMPTZ`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "notBefore"`);
  }
}
