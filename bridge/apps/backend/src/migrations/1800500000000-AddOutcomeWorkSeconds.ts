import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOutcomeWorkSeconds1800500000000 implements MigrationInterface {
  name = 'AddOutcomeWorkSeconds1800500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "improve_outcomes" ADD "workSeconds" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "improve_outcomes" DROP COLUMN "workSeconds"`,
    );
  }
}
