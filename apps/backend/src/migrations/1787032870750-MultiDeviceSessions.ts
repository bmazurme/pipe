import { MigrationInterface, QueryRunner } from 'typeorm';

export class MultiDeviceSessions1787032870750 implements MigrationInterface {
  name = 'MultiDeviceSessions1787032870750';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "sessions" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "refreshTokenHash" character varying(255) NOT NULL, "userAgent" character varying(255), "ip" character varying(64), "expiresAt" TIMESTAMP NOT NULL, "lastUsedAt" TIMESTAMP, "revokedAt" TIMESTAMP, CONSTRAINT "PK_3238ef96f18b355b671619111bc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_57de40bc620f456c7311aa3a1e" ON "sessions" ("userId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "sessions" ADD CONSTRAINT "FK_57de40bc620f456c7311aa3a1e6" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_4fdf5f552fcfe06082a35e97288"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "refreshToken"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "refreshToken" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_4fdf5f552fcfe06082a35e97288" UNIQUE ("refreshToken")`,
    );
    await queryRunner.query(
      `ALTER TABLE "sessions" DROP CONSTRAINT "FK_57de40bc620f456c7311aa3a1e6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_57de40bc620f456c7311aa3a1e"`,
    );
    await queryRunner.query(`DROP TABLE "sessions"`);
  }
}
