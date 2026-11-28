import './pg-timestamp-parser';

import { AppDataSource } from './data-source';
import { ReencryptService } from './rotation/reencrypt.service';

// S11: `node dist/reencrypt-cli.js [--status | --dry-run]` — moves every encrypted value to CREDENTIALS_ENC_KEY_CURRENT. Run inside the backend container
// (docs/key-rotation.md). It opens only a database connection: no Nest app, so none of bridge's schedulers or Telegram senders start with it.
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const known = ['--status', '--dry-run'];
  const unknown = args.filter((arg) => !known.includes(arg));

  if (unknown.length > 0) {
    console.error(`unknown argument: ${unknown.join(' ')} (use --status or --dry-run)`);
    process.exit(64);
  }

  await AppDataSource.initialize();

  try {
    const service = new ReencryptService(AppDataSource);

    if (args.includes('--status')) {
      const status = await service.status();

      for (const column of status.columns) {
        const keys = Object.entries(column.byKey)
          .map(([id, count]) => `${id}:${count}`)
          .join(' ');

        console.log(`${column.table}.${column.column}: ${column.total} value(s) ${keys}${column.unrecognised ? ` (+${column.unrecognised} not encrypted)` : ''}`);
      }

      console.log(`current key: ${status.currentKeyId}; still under another key: ${status.pending}`);

      return;
    }

    const result = await service.run({ dryRun: args.includes('--dry-run') });

    console.log(`${result.dryRun ? 'would move' : 'moved'} ${result.moved} value(s) to ${result.currentKeyId}; ${result.alreadyCurrent} already there`);

    for (const failure of result.failed) console.error(`NOT moved: ${failure.where}: ${failure.reason}`);

    if (result.failed.length > 0) process.exitCode = 1;
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
