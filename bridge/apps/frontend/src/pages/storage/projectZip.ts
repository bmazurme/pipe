import { Zip, ZipDeflate } from 'fflate';

import { applyDictionary } from '../purge/purgeUtils';
import { isTextFile } from './textFiles';

const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
]);

// Templates meant to be committed as-is (no real secrets), so they're kept
// even though every other `.env*` file is dropped.
const ENV_FILE_ALLOWLIST = new Set(['.env.example', '.env.sample', '.env.template']);

function isEnvFile(name: string): boolean {
  if (ENV_FILE_ALLOWLIST.has(name)) return false;
  return name === '.env' || name.startsWith('.env.');
}

function isExcludedPath(relativePath: string): boolean {
  const segments = relativePath.split('/');
  const dirs = segments.slice(0, -1);
  const name = segments[segments.length - 1] ?? '';

  return dirs.some((segment) => EXCLUDED_DIRS.has(segment)) || isEnvFile(name);
}

export function deriveZipName(files: File[]): string {
  const firstPath = files[0]?.webkitRelativePath;
  const rootDir = firstPath?.split('/')[0];
  return `${rootDir || 'project'}.zip`;
}

export interface ProjectZipResult {
  blob: Blob;
  fileCount: number;
  excludedCount: number;
  replacedCount: number;
}

// Folders picked via <input webkitdirectory> never contain empty
// directories, only files with a relative path — so filtering the flat file
// list is enough, no tree walk needed. Excluded entries are skipped before
// they're ever read, which is what keeps this fast for a typical project
// (node_modules dwarfs everything else and is never touched).
export async function buildProjectZip(
  all: File[],
  dictionary: Map<string, string>,
  onProgress: (fraction: number) => void,
): Promise<ProjectZipResult> {
  const included = all.filter(
    (file) => !isExcludedPath(file.webkitRelativePath || file.name),
  );

  if (included.length === 0) {
    throw new Error('В папке не найдено файлов для загрузки');
  }

  const chunks: Uint8Array[] = [];
  let replacedCount = 0;
  let processed = 0;

  const archiveDone = new Promise<void>((resolve, reject) => {
    const zip = new Zip((err, chunk, final) => {
      if (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      chunks.push(chunk);
      if (final) resolve();
    });

    void (async () => {
      try {
        for (const file of included) {
          const path = file.webkitRelativePath || file.name;
          const stream = new ZipDeflate(path);
          zip.add(stream);

          if (isTextFile(file.name) && dictionary.size > 0) {
            const text = await file.text();
            const { result, count } = applyDictionary(text, dictionary);
            replacedCount += count;
            stream.push(new TextEncoder().encode(result), true);
          } else {
            stream.push(new Uint8Array(await file.arrayBuffer()), true);
          }

          processed += 1;
          onProgress(processed / included.length);
        }

        zip.end();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });

  await archiveDone;

  return {
    blob: new Blob(chunks as BlobPart[], { type: 'application/zip' }),
    fileCount: included.length,
    excludedCount: all.length - included.length,
    replacedCount,
  };
}
