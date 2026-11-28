import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddJobDeferrable1800600000000 implements MigrationInterface {
  name = 'AddJobDeferrable1800600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "jobs" ADD "deferrable" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" ADD "limitDeferredAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "limitDeferredAt"`);
    await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "deferrable"`);
  }
}
