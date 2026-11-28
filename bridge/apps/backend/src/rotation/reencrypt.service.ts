import { Injectable } from '@nestjs/common';
import { DataSource, EntityMetadata } from 'typeorm';

import {
  currentKeyId,
  decryptValue,
  encryptValue,
  encryptedColumn,
  keyIdOf,
} from '../crypto/encrypted-column.transformer';

const BATCH = 200;

export interface ColumnReport {
  table: string;
  column: string;
  total: number;
  // How many values sit under each key id, plus the ones that are not in our shape at all (legacy plaintext: never touched).
  byKey: Record<string, number>;
  unrecognised: number;
}

export interface ReencryptStatus {
  currentKeyId: string;
  columns: ColumnReport[];
  // Values under a key other than the current one: what a rotation still has to move.
  pending: number;
}

export interface ReencryptResult {
  currentKeyId: string;
  dryRun: boolean;
  moved: number;
  alreadyCurrent: number;
  // Never altered. `where` names the row, never the value.
  failed: { where: string; reason: string }[];
  skippedTables: string[];
}

interface EncryptedTarget {
  table: string;
  column: string;
  pk: string;
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

function transformerOf(column: { transformer?: unknown }): unknown {
  const t = column.transformer;

  return Array.isArray(t) ? t.find((x) => x === encryptedColumn) : t;
}

// S11: moves every encrypted column value to the current key (CREDENTIALS_ENC_KEY_CURRENT). Reads and writes the STORED text with raw SQL, so the column's
// own lenient transformer never gets between a value and its rotation. A value that does not decrypt is reported and left exactly as it is — a
// rotation must never turn «the old key is somewhere» into «the secret is gone».
@Injectable()
export class ReencryptService {
  constructor(private readonly dataSource: DataSource) {}

  async status(): Promise<ReencryptStatus> {
    const { targets } = this.targets();
    const columns: ColumnReport[] = [];

    for (const target of targets) columns.push(await this.report(target));

    return {
      currentKeyId: currentKeyId(),
      columns,
      pending: columns.reduce(
        (sum, column) =>
          sum +
          Object.entries(column.byKey)
            .filter(([id]) => id !== currentKeyId())
            .reduce((n, [, count]) => n + count, 0),
        0,
      ),
    };
  }

  async run(options: { dryRun?: boolean } = {}): Promise<ReencryptResult> {
    const current = currentKeyId();
    const { targets, skipped } = this.targets();
    const result: ReencryptResult = {
      currentKeyId: current,
      dryRun: options.dryRun === true,
      moved: 0,
      alreadyCurrent: 0,
      failed: [],
      skippedTables: skipped,
    };

    // The new key must exist before anything is touched: encryptValue throws on a missing key.
    encryptValue('probe', current);

    for (const target of targets) {
      let last: unknown = null;

      for (;;) {
        const rows: { id: unknown; v: string }[] = await this.dataSource.query(
          `SELECT ${quote(target.pk)} AS id, ${quote(target.column)} AS v FROM ${quote(target.table)} ` +
            `WHERE ${quote(target.column)} IS NOT NULL ${last === null ? '' : `AND ${quote(target.pk)} > $1 `}` +
            `ORDER BY ${quote(target.pk)} LIMIT ${BATCH}`,
          last === null ? [] : [last],
        );

        if (rows.length === 0) break;

        for (const row of rows) {
          last = row.id;

          const id = keyIdOf(row.v);

          if (id === null) continue;
          if (id === current) {
            result.alreadyCurrent += 1;
            continue;
          }

          const where = `${target.table}.${target.column} #${String(row.id)}`;

          try {
            const next = encryptValue(decryptValue(row.v), current);

            if (!result.dryRun) {
              // Compare-and-swap: a row someone saved in the meantime already went under the current key and is left alone.
              const changed: [unknown[], number] = await this.dataSource.query(
                `UPDATE ${quote(target.table)} SET ${quote(target.column)} = $1 ` +
                  `WHERE ${quote(target.pk)} = $2 AND ${quote(target.column)} = $3`,
                [next, row.id, row.v],
              );

              if (changed[1] === 0) continue;
            }

            result.moved += 1;
          } catch (error) {
            result.failed.push({
              where,
              reason: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    }

    return result;
  }

  private async report(target: EncryptedTarget): Promise<ColumnReport> {
    const rows: { v: string }[] = await this.dataSource.query(
      `SELECT ${quote(target.column)} AS v FROM ${quote(target.table)} WHERE ${quote(target.column)} IS NOT NULL`,
    );
    const byKey: Record<string, number> = {};
    let unrecognised = 0;

    for (const row of rows) {
      const id = keyIdOf(row.v);

      if (id === null) unrecognised += 1;
      else byKey[id] = (byKey[id] ?? 0) + 1;
    }

    return {
      table: target.table,
      column: target.column,
      total: rows.length,
      byKey,
      unrecognised,
    };
  }

  private targets(): { targets: EncryptedTarget[]; skipped: string[] } {
    const targets: EncryptedTarget[] = [];
    const skipped: string[] = [];

    for (const meta of this.dataSource.entityMetadatas as EntityMetadata[]) {
      const columns = meta.columns.filter((column) => transformerOf(column));

      if (columns.length === 0) continue;

      // A composite or missing primary key cannot be walked in batches or updated by id; none of today's entities has one.
      if (meta.primaryColumns.length !== 1) {
        skipped.push(meta.tableName);
        continue;
      }

      for (const column of columns) {
        targets.push({
          table: meta.tableName,
          column: column.databaseName,
          pk: meta.primaryColumns[0].databaseName,
        });
      }
    }

    return { targets, skipped };
  }
}
