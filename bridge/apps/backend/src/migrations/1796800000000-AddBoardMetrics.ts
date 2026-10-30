import { MigrationInterface, QueryRunner } from 'typeorm';

// The boards' vital signs (temperature, throttling, fan, load, memory, disk), one reading per board every ~2 minutes, kept for 7 days.
export class AddBoardMetrics1796800000000 implements MigrationInterface {
  name = 'AddBoardMetrics1796800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "board_metrics" ("id" SERIAL NOT NULL, "userId" integer NOT NULL, "host" character varying(100) NOT NULL, "at" TIMESTAMP NOT NULL, "data" jsonb NOT NULL, CONSTRAINT "PK_board_metrics_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_board_metrics_user_host_at" ON "board_metrics" ("userId", "host", "at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_board_metrics_at" ON "board_metrics" ("at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_board_metrics_at"`);
    await queryRunner.query(`DROP INDEX "IDX_board_metrics_user_host_at"`);
    await queryRunner.query(`DROP TABLE "board_metrics"`);
  }
}
