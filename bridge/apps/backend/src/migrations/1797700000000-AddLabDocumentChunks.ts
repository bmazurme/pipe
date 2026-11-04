import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLabDocumentChunks1797700000000 implements MigrationInterface {
  name = 'AddLabDocumentChunks1797700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "lab_document_chunks" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "projectId" integer NOT NULL, "path" character varying(500) NOT NULL, "heading" character varying(300), "chunkIndex" integer NOT NULL, "content" text NOT NULL, CONSTRAINT "PK_lab_document_chunks_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_lab_document_chunks_projectId" ON "lab_document_chunks" ("projectId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "lab_document_chunks" ADD CONSTRAINT "FK_lab_document_chunks_projectId" FOREIGN KEY ("projectId") REFERENCES "lab_projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lab_document_chunks" DROP CONSTRAINT "FK_lab_document_chunks_projectId"`,
    );
    await queryRunner.query(`DROP TABLE "lab_document_chunks"`);
  }
}
