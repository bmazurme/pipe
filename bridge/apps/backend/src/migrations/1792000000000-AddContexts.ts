import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddContexts1792000000000 implements MigrationInterface {
  name = 'AddContexts1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "contexts" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "name" character varying(100) NOT NULL, "content" text NOT NULL, CONSTRAINT "PK_contexts_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_contexts_userId" ON "contexts" ("userId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_contexts_userId_name" ON "contexts" ("userId", "name")`,
    );
    await queryRunner.query(
      `ALTER TABLE "contexts" ADD CONSTRAINT "FK_contexts_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    // A job keeps its own copy of the context it started with (name for display,
    // text for the worker), so editing or deleting the context later changes nothing.
    await queryRunner.query(
      `ALTER TABLE "jobs" ADD "contextName" character varying(100)`,
    );
    await queryRunner.query(`ALTER TABLE "jobs" ADD "contextText" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "contextText"`);
    await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "contextName"`);
    await queryRunner.query(
      `ALTER TABLE "contexts" DROP CONSTRAINT "FK_contexts_userId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_contexts_userId_name"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_contexts_userId"`);
    await queryRunner.query(`DROP TABLE "contexts"`);
  }
}
