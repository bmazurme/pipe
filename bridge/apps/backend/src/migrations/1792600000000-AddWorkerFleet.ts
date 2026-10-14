import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkerFleet1792600000000 implements MigrationInterface {
  name = 'AddWorkerFleet1792600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "workers" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "name" character varying(100) NOT NULL, "enabled" boolean NOT NULL DEFAULT true, "keyHash" character varying(255), "keyPrefix" character varying(16), "enrollCodeHash" character varying(255), "enrollExpiresAt" TIMESTAMP, "lastSeenAt" TIMESTAMP, "hostname" character varying(255), "version" character varying(64), "models" text, "pollIntervalSec" smallint NOT NULL DEFAULT 10, "jobTimeoutSec" integer NOT NULL DEFAULT 1800, "proxyUrl" character varying(500), "chatEnabled" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_workers_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_workers_userId" ON "workers" ("userId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_workers_userId_name" ON "workers" ("userId", "name")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_workers_keyHash" ON "workers" ("keyHash")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_workers_enrollCodeHash" ON "workers" ("enrollCodeHash")`,
    );
    await queryRunner.query(
      `ALTER TABLE "workers" ADD CONSTRAINT "FK_workers_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE TABLE "provider_credentials" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, "provider" character varying(16) NOT NULL, "name" character varying(255) NOT NULL, "apiKey" text NOT NULL, "baseUrl" character varying(500), "model" character varying(100), CONSTRAINT "PK_provider_credentials_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_provider_credentials_userId" ON "provider_credentials" ("userId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "provider_credentials" ADD CONSTRAINT "FK_provider_credentials_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "jobs" ADD "providerCredentialId" integer`,
    );
    await queryRunner.query(`ALTER TABLE "jobs" ADD "workerId" integer`);
    await queryRunner.query(`ALTER TABLE "jobs" ADD "targetWorkerId" integer`);
    await queryRunner.query(
      `ALTER TABLE "jobs" ADD CONSTRAINT "FK_jobs_providerCredentialId" FOREIGN KEY ("providerCredentialId") REFERENCES "provider_credentials"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" ADD CONSTRAINT "FK_jobs_workerId" FOREIGN KEY ("workerId") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" ADD CONSTRAINT "FK_jobs_targetWorkerId" FOREIGN KEY ("targetWorkerId") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    // The claim query filters queued jobs by pin and the "is this worker busy" check by claimer.
    await queryRunner.query(
      `CREATE INDEX "IDX_jobs_workerId_status" ON "jobs" ("workerId", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_jobs_workerId_status"`);
    await queryRunner.query(
      `ALTER TABLE "jobs" DROP CONSTRAINT "FK_jobs_targetWorkerId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" DROP CONSTRAINT "FK_jobs_workerId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" DROP CONSTRAINT "FK_jobs_providerCredentialId"`,
    );
    await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "targetWorkerId"`);
    await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "workerId"`);
    await queryRunner.query(
      `ALTER TABLE "jobs" DROP COLUMN "providerCredentialId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "provider_credentials" DROP CONSTRAINT "FK_provider_credentials_userId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_provider_credentials_userId"`,
    );
    await queryRunner.query(`DROP TABLE "provider_credentials"`);
    await queryRunner.query(
      `ALTER TABLE "workers" DROP CONSTRAINT "FK_workers_userId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_workers_enrollCodeHash"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_workers_keyHash"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_workers_userId_name"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_workers_userId"`);
    await queryRunner.query(`DROP TABLE "workers"`);
  }
}
