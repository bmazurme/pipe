import { createReadStream } from 'fs';
import { unlink } from 'fs/promises';
import type { Readable } from 'stream';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Logger } from '@nestjs/common';

import { FileMissingError, FileStore } from './file-store';

export interface S3FileStoreOptions {
  // One or more endpoints of the SAME bucket (Garage: any node of the cluster serves it). A request that
  // cannot connect goes to the next one, and the one that worked is tried first from then on.
  endpoints: string[];
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
]);

// What justifies trying another endpoint: the node is unreachable, or it answers that the cluster
// cannot serve the request right now (Garage: 503 without quorum). A refusal that another node would
// repeat (AccessDenied, NoSuchBucket) is not retried.
export function isEndpointFailure(error: unknown): boolean {
  const e = error as {
    name?: string;
    code?: string;
    message?: string;
    cause?: { code?: string };
    $metadata?: { httpStatusCode?: number };
  };
  const code = e?.code ?? e?.cause?.code;

  if (code && NETWORK_ERROR_CODES.has(code)) return true;
  // The SDK re-wraps a foreign-realm error (a plain Error without `code`) keeping only its text.
  if (
    typeof e?.message === 'string' &&
    [...NETWORK_ERROR_CODES].some((c) => e.message?.includes(c))
  ) {
    return true;
  }
  if (e?.name === 'TimeoutError' || e?.name === 'RequestTimeout') return true;

  const status = e?.$metadata?.httpStatusCode;

  return status !== undefined && status >= 500;
}

function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };

  return (
    e?.name === 'NoSuchKey' ||
    e?.name === 'NotFound' ||
    e?.$metadata?.httpStatusCode === 404
  );
}

export class S3FileStore implements FileStore {
  readonly driver = 's3' as const;
  private readonly logger = new Logger(S3FileStore.name);
  private readonly clients: S3Client[];
  private active = 0;

  // `clientFactory` is for tests (a fake client per endpoint); the default builds the real one.
  constructor(
    private readonly options: S3FileStoreOptions,
    clientFactory: (endpoint: string) => S3Client = (endpoint) =>
      S3FileStore.createClient(options, endpoint),
  ) {
    if (options.endpoints.length === 0) {
      throw new Error('S3FileStore needs at least one endpoint');
    }

    this.clients = options.endpoints.map(clientFactory);
  }

  private static createClient(
    options: S3FileStoreOptions,
    endpoint: string,
  ): S3Client {
    return new S3Client({
      endpoint,
      region: options.region,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
      // Garage (like MinIO) addresses buckets in the path, not in a subdomain.
      forcePathStyle: true,
      // The SDK's default CRC checksums are for AWS; send them only where a call requires one.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      // Failing over to the next node is ours (below) and quicker than the SDK's own retries.
      maxAttempts: 1,
      requestHandler: {
        requestTimeout: 60_000,
        connectionTimeout: 5_000,
      },
    });
  }

  // Runs `operation` against the active endpoint; on an endpoint failure, against the next ones.
  private async run<T>(
    operation: (client: S3Client) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;

    for (let step = 0; step < this.clients.length; step++) {
      const index = (this.active + step) % this.clients.length;

      try {
        const result = await operation(this.clients[index]);

        if (index !== this.active) {
          this.logger.warn(
            `S3 endpoint ${this.options.endpoints[this.active]} failed — using ${this.options.endpoints[index]}`,
          );
          this.active = index;
        }

        return result;
      } catch (error) {
        lastError = error;

        if (!isEndpointFailure(error)) throw error;
      }
    }

    throw lastError;
  }

  localPath(): null {
    return null;
  }

  async adopt(key: string, stagedPath: string): Promise<void> {
    try {
      // Streamed (multipart above 5 MB): an upload is never held in memory. A fresh stream per
      // endpoint attempt, because a half-read one cannot be replayed.
      await this.run((client) =>
        new Upload({
          client,
          params: {
            Bucket: this.options.bucket,
            Key: key,
            Body: createReadStream(stagedPath),
          },
        }).done(),
      );
    } finally {
      // The staging copy is not the file: gone whether or not the upload worked.
      await unlink(stagedPath).catch(() => undefined);
    }
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    await this.run((client) =>
      client.send(
        new PutObjectCommand({
          Bucket: this.options.bucket,
          Key: key,
          Body: bytes,
        }),
      ),
    );
  }

  async stat(key: string): Promise<{ size: number } | null> {
    try {
      const head = await this.run((client) =>
        client.send(
          new HeadObjectCommand({ Bucket: this.options.bucket, Key: key }),
        ),
      );

      return { size: head.ContentLength ?? 0 };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async openRead(key: string): Promise<Readable> {
    try {
      const object = await this.run((client) =>
        client.send(
          new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
        ),
      );

      return object.Body as Readable;
    } catch (error) {
      if (isNotFound(error)) throw new FileMissingError(key);
      throw error;
    }
  }

  async readBytes(key: string): Promise<Buffer> {
    const stream = await this.openRead(key);
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      chunks.push(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string),
      );
    }

    return Buffer.concat(chunks);
  }

  async remove(key: string): Promise<void> {
    await this.run((client) =>
      client.send(
        new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }),
      ),
    );
  }
}
