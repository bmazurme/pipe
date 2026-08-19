import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDayOffType1787145200000 implements MigrationInterface {
  name = 'AddDayOffType1787145200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."day_offs_type_enum" AS ENUM('off', 'holiday', 'short')`,
    );
    await queryRunner.query(
      `ALTER TABLE "day_offs" ADD "type" "public"."day_offs_type_enum" NOT NULL DEFAULT 'off'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "day_offs" DROP COLUMN "type"`);
    await queryRunner.query(`DROP TYPE "public"."day_offs_type_enum"`);
  }
}
