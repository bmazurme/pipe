import { MigrationInterface, QueryRunner } from 'typeorm';

// Lab's weekly digests of finished worker work (a draft note for notes.ntlstl.dev) and how the owner wants them made.
export class AddLabDigests1798400000000 implements MigrationInterface {
  name = 'AddLabDigests1798400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "lab_digests" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "weekStart" character varying(10) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'generating', "includePrivate" boolean NOT NULL DEFAULT false, "model" character varying(32) NOT NULL, "jobId" integer, "items" jsonb NOT NULL DEFAULT '[]', "excludedPrivate" integer NOT NULL DEFAULT '0', "title" character varying(100), "preview" text, "content" text, "tags" jsonb NOT NULL DEFAULT '[]', "noteType" character varying(100) NOT NULL DEFAULT 'Dev Work Diary', "error" text, "exportedAt" TIMESTAMP, "finishedAt" TIMESTAMP, CONSTRAINT "PK_lab_digests_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_lab_digests_userId_weekStart" ON "lab_digests" ("userId", "weekStart")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_lab_digests_status" ON "lab_digests" ("status")`,
    );
    await queryRunner.query(
      `CREATE TABLE "lab_digest_settings" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "autoWeekly" boolean NOT NULL DEFAULT false, "includePrivate" boolean NOT NULL DEFAULT false, "model" character varying(32) NOT NULL DEFAULT 'haiku', CONSTRAINT "PK_lab_digest_settings_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_lab_digest_settings_userId" ON "lab_digest_settings" ("userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_lab_digest_settings_userId"`);
    await queryRunner.query(`DROP TABLE "lab_digest_settings"`);
    await queryRunner.query(`DROP INDEX "IDX_lab_digests_status"`);
    await queryRunner.query(`DROP INDEX "IDX_lab_digests_userId_weekStart"`);
    await queryRunner.query(`DROP TABLE "lab_digests"`);
  }
}
