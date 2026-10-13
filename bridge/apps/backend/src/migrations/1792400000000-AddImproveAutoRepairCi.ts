import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddImproveAutoRepairCi1792400000000 implements MigrationInterface {
  name = 'AddImproveAutoRepairCi1792400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "improve_settings" ADD "autoRepairCi" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "improve_settings" DROP COLUMN "autoRepairCi"`,
    );
  }
}
