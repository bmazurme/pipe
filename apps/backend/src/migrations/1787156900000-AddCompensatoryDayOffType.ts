import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCompensatoryDayOffType1787156900000 implements MigrationInterface {
  name = 'AddCompensatoryDayOffType1787156900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."day_offs_type_enum" ADD VALUE 'compensatory'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres has no DROP VALUE for enums — rebuild the type without it.
    // Fails loudly (as it should) if any row still uses 'compensatory'.
    await queryRunner.query(
      `ALTER TYPE "public"."day_offs_type_enum" RENAME TO "day_offs_type_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."day_offs_type_enum" AS ENUM('off', 'holiday', 'short')`,
    );
    await queryRunner.query(
      `ALTER TABLE "day_offs" ALTER COLUMN "type" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "day_offs" ALTER COLUMN "type" TYPE "public"."day_offs_type_enum" USING "type"::"text"::"public"."day_offs_type_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "day_offs" ALTER COLUMN "type" SET DEFAULT 'off'`,
    );
    await queryRunner.query(`DROP TYPE "public"."day_offs_type_enum_old"`);
  }
}
