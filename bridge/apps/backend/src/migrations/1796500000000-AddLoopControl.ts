import { MigrationInterface, QueryRunner } from 'typeorm';

// The kill-switch of the automation: one row, paused or not.
export class AddLoopControl1796500000000 implements MigrationInterface {
  name = 'AddLoopControl1796500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "loop_control" ("id" integer NOT NULL, "paused" boolean NOT NULL DEFAULT false, "reason" character varying(300), "pausedBy" character varying(16), "pausedAt" TIMESTAMP, "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_loop_control_id" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "loop_control"`);
  }
}
