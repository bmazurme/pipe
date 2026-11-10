import { MigrationInterface, QueryRunner } from 'typeorm';

// The base-branch commit a Lab project's knowledge chunks were built from, so an unchanged branch skips the reindex download.
export class AddLabProjectKnowledgeSha1797800000000 implements MigrationInterface {
  name = 'AddLabProjectKnowledgeSha1797800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lab_projects" ADD "knowledgeSha" character varying(40)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lab_projects" DROP COLUMN "knowledgeSha"`,
    );
  }
}
