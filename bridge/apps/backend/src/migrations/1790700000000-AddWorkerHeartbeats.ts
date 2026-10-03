import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkerHeartbeats1790700000000 implements MigrationInterface {
  name = 'AddWorkerHeartbeats1790700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "worker_heartbeats" ("userId" integer NOT NULL, "workerName" character varying(255) NOT NULL, "lastSeenAt" TIMESTAMP NOT NULL, CONSTRAINT "PK_worker_heartbeats_userId_workerName" PRIMARY KEY ("userId", "workerName"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "worker_heartbeats" ADD CONSTRAINT "FK_worker_heartbeats_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "worker_heartbeats" DROP CONSTRAINT "FK_worker_heartbeats_userId"`,
    );
    await queryRunner.query(`DROP TABLE "worker_heartbeats"`);
  }
}
