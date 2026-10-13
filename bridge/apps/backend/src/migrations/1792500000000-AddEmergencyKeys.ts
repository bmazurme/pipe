import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEmergencyKeys1792500000000 implements MigrationInterface {
  name = 'AddEmergencyKeys1792500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "emergency_keys" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "prefix" character varying(16) NOT NULL, "keyHash" character varying(255) NOT NULL, "lastUsedAt" TIMESTAMP, CONSTRAINT "PK_emergency_keys_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_emergency_keys_userId" ON "emergency_keys" ("userId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_emergency_keys_keyHash" ON "emergency_keys" ("keyHash")`,
    );
    await queryRunner.query(
      `ALTER TABLE "emergency_keys" ADD CONSTRAINT "FK_emergency_keys_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "emergency_keys" DROP CONSTRAINT "FK_emergency_keys_userId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_emergency_keys_keyHash"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_emergency_keys_userId"`);
    await queryRunner.query(`DROP TABLE "emergency_keys"`);
  }
}
