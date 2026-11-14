import { posix } from 'path';

// What a landing release may contain and how its paths are read. The release is an archive the owner uploads, but the site it
// becomes is served to the public from a volume this backend can write to, so every path is checked before a byte is written.
export const LANDING_ALLOWED_EXTENSIONS = [
  '.html',
  '.css',
  '.js',
  '.json',
  '.txt',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.ico',
  '.woff2',
  '.mp4',
  '.webm',
] as const;

export const LANDING_MAX_ZIP_BYTES = 50 * 1024 * 1024;
export const LANDING_LIMITS = {
  maxEntries: 500,
  maxEntryBytes: 30 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
};
export const LANDING_KEEP_RELEASES = 5;

export interface LandingFile {
  path: string;
  bytes: Uint8Array;
}

// Junk an archive made on a Mac carries along; dropped quietly instead of failing the release.
function isArchiveJunk(path: string): boolean {
  const parts = path.split('/');
  const name = parts[parts.length - 1];

  return (
    parts[0] === '__MACOSX' || name === '.DS_Store' || name.startsWith('._')
  );
}

// Returns the cleaned path, or throws with the reason. Rejects anything that could leave the release directory or hide in it:
// absolute paths, backslashes, `..`, hidden files and an extension off the allowlist.
export function checkLandingPath(raw: string): string {
  if (raw.includes('\\') || raw.includes('\0')) {
    throw new Error(`Недопустимый путь «${raw}»`);
  }

  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) {
    throw new Error(`Абсолютный путь «${raw}» не принимается`);
  }

  const path = posix.normalize(raw);
  const parts = path.split('/');

  if (parts.includes('..') || path === '.') {
    throw new Error(`Путь «${raw}» выходит за каталог релиза`);
  }

  if (parts.some((part) => part.startsWith('.'))) {
    throw new Error(`Скрытый файл «${raw}» не принимается`);
  }

  const ext = posix.extname(path).toLowerCase();

  if (!(LANDING_ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new Error(
      `Тип файла «${raw}» не разрешён (можно: ${LANDING_ALLOWED_EXTENSIONS.join(' ')})`,
    );
  }

  return path;
}

// Turns the entries of an unzipped archive into the files of a release: directories and Mac junk dropped, one wrapping folder
// stripped (an archive of a folder has it), paths checked, and an index.html at the root required.
export function releaseFiles(
  entries: Record<string, Uint8Array>,
): LandingFile[] {
  const names = Object.keys(entries).filter(
    (name) => !name.endsWith('/') && !isArchiveJunk(name),
  );

  if (names.length === 0) throw new Error('В архиве нет файлов');

  const tops = new Set(names.map((name) => name.split('/')[0]));
  const wrapped =
    tops.size === 1 &&
    names.every((name) => name.includes('/')) &&
    !names.includes('index.html');
  const files = names.map((name) => ({
    path: checkLandingPath(wrapped ? name.split('/').slice(1).join('/') : name),
    bytes: entries[name],
  }));

  if (new Set(files.map((file) => file.path)).size !== files.length) {
    throw new Error('В архиве повторяются имена файлов');
  }

  if (!files.some((file) => file.path === 'index.html')) {
    throw new Error('В корне архива нет index.html');
  }

  return files;
}

// A directory name that sorts by time and cannot collide with the legacy / script ones.
export function releaseDirName(now: Date, suffix: string): string {
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);

  return `r${stamp}-${suffix}`;
}
