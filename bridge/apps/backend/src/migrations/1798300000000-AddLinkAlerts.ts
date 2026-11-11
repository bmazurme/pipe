import { MigrationInterface, QueryRunner } from 'typeorm';

// The conditions about the VPN channels that were announced on Telegram and have not ended yet.
export class AddLinkAlerts1798300000000 implements MigrationInterface {
  name = 'AddLinkAlerts1798300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "link_alerts" ("key" character varying(255) NOT NULL, "since" TIMESTAMP NOT NULL, "recovered" character varying(500) NOT NULL, CONSTRAINT "PK_link_alerts_key" PRIMARY KEY ("key"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "link_alerts"`);
  }
}
