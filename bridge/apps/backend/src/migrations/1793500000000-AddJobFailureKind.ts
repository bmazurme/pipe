import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddJobFailureKind1793500000000 implements MigrationInterface {
  name = 'AddJobFailureKind1793500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "jobs" ADD "failureKind" character varying(16)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "failureKind"`);
  }
}
