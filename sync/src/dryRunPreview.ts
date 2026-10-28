import { log } from './log.js';

const DRY_RUN_PREVIEW_LIMIT = 20;

// Shared by push and push-issue --dry-run: the first 20 paths at info level,
// the rest at debug (-v), then the leak-finding count.
export function logFilePreview(files: { relPath: string }[], leakCount: number): void {
  const preview = files.slice(0, DRY_RUN_PREVIEW_LIMIT);
  for (const f of preview) log.info(`  ${f.relPath}`);
  if (files.length > preview.length) {
    log.info(`  … and ${files.length - preview.length} more (use -v to list all)`);
    for (const f of files.slice(preview.length)) log.debug(`  ${f.relPath}`);
  }
  log.info(leakCount > 0 ? `Leak findings: ${leakCount}` : 'Leak findings: none');
}
