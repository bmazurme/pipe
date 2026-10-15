import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// infra/backup/mirror-s3.sh writes a bare UTC stamp like "20261012T030000Z"
// (no JSON framing) to this key, naming the newest snapshot folder.
const LATEST_KEY = 'LATEST';
const STAMP_PATTERN = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

export interface BackupStatus {
  configured: boolean;
  lastBackupAt: string | null;
  rawBytes: number | null;
  error?: string;
}

function parseStamp(stamp: string): Date | null {
  const match = STAMP_PATTERN.exec(stamp.trim());

  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;

  return new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ),
  );
}

function parseRawBytes(metaEnv: string): number | null {
  const match = /^RAW_BYTES=(\d+)$/m.exec(metaEnv);

  return match ? Number(match[1]) : null;
}

// Reads bridge-backups/LATEST (and that snapshot's meta.env) straight from
// Garage S3 — infra/backup/backup.sh + mirror-s3.sh write both server-side;
// bridge never runs or triggers a backup, only reports on the last one.
@Injectable()
export class BackupStatusService {
  private readonly logger = new Logger(BackupStatusService.name);

  // The factory is overridable in tests, the same way S3FileStore takes one
  // — a real client needs a reachable Garage endpoint, a fake `send` doesn't.
  constructor(
    private readonly configService: ConfigService,
    @Optional()
    private readonly clientFactory: (options: {
      endpoint: string;
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
    }) => S3Client = (options) =>
      new S3Client({
        endpoint: options.endpoint,
        region: options.region,
        forcePathStyle: true,
        credentials: {
          accessKeyId: options.accessKeyId,
          secretAccessKey: options.secretAccessKey,
        },
        maxAttempts: 1,
      }),
  ) {}

  async getStatus(): Promise<BackupStatus> {
    const client = this.client();

    if (!client) {
      return { configured: false, lastBackupAt: null, rawBytes: null };
    }

    const bucket =
      this.configService.get<string>('BACKUP_S3_BUCKET') || 'bridge-backups';

    try {
      const stamp = await this.getObjectText(client, bucket, LATEST_KEY);
      const date = parseStamp(stamp);

      if (!date) {
        throw new Error(`LATEST has an unrecognized shape: "${stamp}"`);
      }

      let rawBytes: number | null = null;

      try {
        const metaEnv = await this.getObjectText(
          client,
          bucket,
          `snapshots/${stamp.trim()}/meta.env`,
        );

        rawBytes = parseRawBytes(metaEnv);
      } catch (error) {
        this.logger.warn(
          `meta.env unavailable for ${stamp.trim()}: ${message(error)}`,
        );
      }

      return { configured: true, lastBackupAt: date.toISOString(), rawBytes };
    } catch (error) {
      this.logger.warn(`getStatus failed: ${message(error)}`);

      return {
        configured: true,
        lastBackupAt: null,
        rawBytes: null,
        error: message(error),
      };
    }
  }

  private async getObjectText(
    client: S3Client,
    bucket: string,
    key: string,
  ): Promise<string> {
    const object = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );

    return (await object.Body?.transformToString()) ?? '';
  }

  private client(): S3Client | null {
    const endpoint = this.firstEndpoint();
    const accessKeyId = this.configService.get<string>(
      'BACKUP_S3_ACCESS_KEY_ID',
    );
    const secretAccessKey = this.configService.get<string>(
      'BACKUP_S3_SECRET_ACCESS_KEY',
    );

    if (!endpoint || !accessKeyId || !secretAccessKey) return null;

    return this.clientFactory({
      endpoint,
      region: this.configService.get<string>('BACKUP_S3_REGION') || 'garage',
      accessKeyId,
      secretAccessKey,
    });
  }

  // Same "comma-separated list, use the first" shape as bridge's own
  // S3_ENDPOINT (create-file-store.ts) — kept to one endpoint here since this
  // read is best-effort status, not the storage path that needs failover.
  private firstEndpoint(): string | undefined {
    const raw = this.configService.get<string>('BACKUP_S3_ENDPOINT') || '';

    return raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)[0];
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
