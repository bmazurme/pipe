import { MigrationInterface, QueryRunner } from 'typeorm';

// A pipeline parcel is deleted from storage once its job succeeds (see
// WorkerService.setResult). With the old ON DELETE CASCADE that delete would
// have taken the job row — its logs and status — down with it, so the link
// becomes a nullable SET NULL: the job outlives its consumed source.
export class JobSourceFileSetNull1791200000000 implements MigrationInterface {
  name = 'JobSourceFileSetNull1791200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "jobs" DROP CONSTRAINT "FK_jobs_sourceFileId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" ALTER COLUMN "sourceFileId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" ADD CONSTRAINT "FK_jobs_sourceFileId" FOREIGN KEY ("sourceFileId") REFERENCES "stored_files"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Jobs whose source was consumed can't satisfy NOT NULL again.
    await queryRunner.query(`DELETE FROM "jobs" WHERE "sourceFileId" IS NULL`);
    await queryRunner.query(
      `ALTER TABLE "jobs" DROP CONSTRAINT "FK_jobs_sourceFileId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" ALTER COLUMN "sourceFileId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" ADD CONSTRAINT "FK_jobs_sourceFileId" FOREIGN KEY ("sourceFileId") REFERENCES "stored_files"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
