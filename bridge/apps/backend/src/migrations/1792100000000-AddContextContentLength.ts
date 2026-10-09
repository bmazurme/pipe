import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddContextContentLength1792100000000 implements MigrationInterface {
  name = 'AddContextContentLength1792100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Nullable on purpose: the text is encrypted, so existing rows' lengths cannot be
    // filled in here. They are recorded the next time each context is saved.
    await queryRunner.query(
      `ALTER TABLE "contexts" ADD "contentLength" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contexts" DROP COLUMN "contentLength"`,
    );
  }
}
