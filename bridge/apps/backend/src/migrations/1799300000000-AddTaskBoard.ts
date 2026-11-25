import { MigrationInterface, QueryRunner } from 'typeorm';

// The personal task board: columns and cards (title + description), archivable.
export class AddTaskBoard1799300000000 implements MigrationInterface {
  name = 'AddTaskBoard1799300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "task_columns" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "title" character varying(100) NOT NULL, "position" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_task_columns_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_task_columns_userId" ON "task_columns" ("userId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_columns" ADD CONSTRAINT "FK_task_columns_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE TABLE "task_cards" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "columnId" integer NOT NULL, "title" character varying(255) NOT NULL, "description" text NOT NULL DEFAULT '', "position" integer NOT NULL DEFAULT '0', "archivedAt" TIMESTAMP, CONSTRAINT "PK_task_cards_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_task_cards_userId" ON "task_cards" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_task_cards_columnId" ON "task_cards" ("columnId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_cards" ADD CONSTRAINT "FK_task_cards_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_cards" ADD CONSTRAINT "FK_task_cards_columnId" FOREIGN KEY ("columnId") REFERENCES "task_columns"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "task_cards"`);
    await queryRunner.query(`DROP TABLE "task_columns"`);
  }
}
