import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRefreshTokenGraceWindow1787254500000 implements MigrationInterface {
  name = 'AddRefreshTokenGraceWindow1787254500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sessions" ADD "previousRefreshTokenHash" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "sessions" ADD "previousRefreshTokenExpiresAt" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sessions" DROP COLUMN "previousRefreshTokenExpiresAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sessions" DROP COLUMN "previousRefreshTokenHash"`,
    );
  }
}
