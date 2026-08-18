import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDayOffs1787062174444 implements MigrationInterface {
  name = 'AddDayOffs1787062174444';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "day_offs" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "date" date NOT NULL, CONSTRAINT "PK_cc6893022d6a7ef56c6479873b0" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_7d9f63605db66709a512101bdb" ON "day_offs" ("userId", "date") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7d9f63605db66709a512101bdb"`,
    );
    await queryRunner.query(`DROP TABLE "day_offs"`);
  }
}
