import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRestoreDrills1800300000000 implements MigrationInterface {
  name = 'AddRestoreDrills1800300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "restore_drills" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "ranAt" TIMESTAMP NOT NULL, "data" jsonb NOT NULL, CONSTRAINT "PK_restore_drills_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_restore_drills_userId_ranAt" ON "restore_drills" ("userId", "ranAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_restore_drills_userId_ranAt"`);
    await queryRunner.query(`DROP TABLE "restore_drills"`);
  }
}
