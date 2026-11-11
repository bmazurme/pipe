import { MigrationInterface, QueryRunner } from 'typeorm';

// Sending a digest to notes.ntlstl.dev as a draft: where and with which (encrypted) key, and which note it became.
export class AddLabDigestNotes1798500000000 implements MigrationInterface {
  name = 'AddLabDigestNotes1798500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lab_digest_settings" ADD "notesUrl" character varying(200), ADD "notesKey" text, ADD "notesKeyHint" character varying(8)`,
    );
    await queryRunner.query(
      `ALTER TABLE "lab_digests" ADD "noteId" integer, ADD "sentAt" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lab_digests" DROP COLUMN "sentAt", DROP COLUMN "noteId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lab_digest_settings" DROP COLUMN "notesKeyHint", DROP COLUMN "notesKey", DROP COLUMN "notesUrl"`,
    );
  }
}
