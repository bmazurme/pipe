import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddJobNotifyOnFinish1793600000001 implements MigrationInterface {
  name = 'AddJobNotifyOnFinish1793600000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "jobs" ADD "notifyOnFinish" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "notifyOnFinish"`);
  }
}
