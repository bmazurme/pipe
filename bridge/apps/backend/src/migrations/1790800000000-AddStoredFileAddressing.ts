import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStoredFileAddressing1790800000000 implements MigrationInterface {
  name = 'AddStoredFileAddressing1790800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."stored_files_direction_enum" AS ENUM('outbound', 'result')`,
    );
    await queryRunner.query(
      `ALTER TABLE "stored_files" ADD COLUMN "channel" character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "stored_files" ADD COLUMN "taskKey" character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "stored_files" ADD COLUMN "direction" "public"."stored_files_direction_enum"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_stored_files_userId_taskKey" ON "stored_files" ("userId", "taskKey")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_stored_files_userId_taskKey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "stored_files" DROP COLUMN "direction"`,
    );
    await queryRunner.query(`ALTER TABLE "stored_files" DROP COLUMN "taskKey"`);
    await queryRunner.query(`ALTER TABLE "stored_files" DROP COLUMN "channel"`);
    await queryRunner.query(`DROP TYPE "public"."stored_files_direction_enum"`);
  }
}
