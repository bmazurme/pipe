import { MigrationInterface, QueryRunner } from 'typeorm';

// What the model router decided for an 'auto' Improve issue run, and why.
export class AddImproveRunRouting1797300000000 implements MigrationInterface {
  name = 'AddImproveRunRouting1797300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "improve_runs" ADD "routing" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "improve_runs" DROP COLUMN "routing"`);
  }
}
