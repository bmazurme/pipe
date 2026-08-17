import { MigrationInterface, QueryRunner } from "typeorm";

export class InitSchema1786996443247 implements MigrationInterface {
    name = 'InitSchema1786996443247'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "purge_entries" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "key" character varying(255) NOT NULL, "value" character varying(500) NOT NULL, CONSTRAINT "PK_c2e3e7ee48b2e35e341d5739d2c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_0955e3531c9fb6ad55416d49a0" ON "purge_entries" ("userId", "value") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_815dbc79e43810b15cd7fbb813" ON "purge_entries" ("userId", "key") `);
        await queryRunner.query(`CREATE TABLE "stored_files" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "originalName" character varying(255) NOT NULL, "storedName" character varying(255) NOT NULL, "mimeType" character varying(255) NOT NULL, "size" integer NOT NULL, CONSTRAINT "UQ_da0519ef09abdd8f4f58db24c3f" UNIQUE ("storedName"), CONSTRAINT "PK_5d5be862bf53851c1794b4adf4e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "users" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "email" character varying(255) NOT NULL, "isActive" boolean NOT NULL DEFAULT false, "status" character varying(255), "refreshToken" character varying(255), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "UQ_4fdf5f552fcfe06082a35e97288" UNIQUE ("refreshToken"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TABLE "stored_files"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_815dbc79e43810b15cd7fbb813"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0955e3531c9fb6ad55416d49a0"`);
        await queryRunner.query(`DROP TABLE "purge_entries"`);
    }

}
