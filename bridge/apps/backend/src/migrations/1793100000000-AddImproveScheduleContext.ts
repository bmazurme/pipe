import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddImproveScheduleContext1793100000000 implements MigrationInterface {
  name = 'AddImproveScheduleContext1793100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "improve_schedules" ADD "contextId" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "improve_schedules" ADD CONSTRAINT "FK_improve_schedules_contextId" FOREIGN KEY ("contextId") REFERENCES "contexts"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "improve_schedules" DROP CONSTRAINT "FK_improve_schedules_contextId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "improve_schedules" DROP COLUMN "contextId"`,
    );
  }
}
