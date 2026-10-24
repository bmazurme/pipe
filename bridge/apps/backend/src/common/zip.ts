import {
  unzip,
  unzipSync,
  zip,
  type Unzipped,
  type Zippable,
  type ZipOptions,
} from 'fflate';

// fflate's callback forms run on worker threads in Node, so large archives do
// not block bridge's event loop.
export function unzipAsync(data: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    unzip(data, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

export interface UnzipLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
}

// For archives a worker (a model on untrusted content) produced: the sizes the zip headers declare are checked BEFORE anything is
// inflated, and the real lengths after it, so neither a huge declared entry nor a lying header can exhaust bridge's memory.
export function unzipBounded(
  data: Uint8Array,
  limits: UnzipLimits,
): Promise<Unzipped> {
  const mb = (n: number) => `${Math.round((n / 1024 / 1024) * 10) / 10} МБ`;
  const tooBig = (what: string) =>
    new Error(`Слишком большой результат worker: ${what}`);

  // Synchronous on purpose (the sizes are bounded above): the async form starts a worker thread per larger file, each with its own
  // copy of the data, which is how a result with many binaries could exhaust memory.
  return new Promise((resolve, reject) => {
    let entries = 0;
    let declared = 0;

    try {
      const out = unzipSync(data, {
        filter: (file) => {
          entries += 1;
          declared += file.originalSize;

          if (entries > limits.maxEntries)
            throw tooBig(`больше ${limits.maxEntries} файлов в архиве`);

          if (file.originalSize > limits.maxEntryBytes)
            throw tooBig(
              `«${file.name}» после распаковки больше ${mb(limits.maxEntryBytes)}`,
            );

          if (declared > limits.maxTotalBytes)
            throw tooBig(
              `общий размер после распаковки больше ${mb(limits.maxTotalBytes)} (на «${file.name}»)`,
            );

          return true;
        },
      });
      let total = 0;

      for (const [name, bytes] of Object.entries(out)) {
        total += bytes.length;

        if (bytes.length > limits.maxEntryBytes)
          throw tooBig(
            `«${name}» после распаковки больше ${mb(limits.maxEntryBytes)}`,
          );
      }

      if (total > limits.maxTotalBytes)
        throw tooBig(
          `общий размер после распаковки больше ${mb(limits.maxTotalBytes)}`,
        );

      resolve(out);
    } catch (error) {
      reject(error);
    }
  });
}

// The level is the caller's call: a short-lived transfer artifact wants speed, a download kept around wants ratio.
export function zipAsync(
  entries: Zippable,
  level: ZipOptions['level'],
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(entries, { level }, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

export interface SnapshotFile {
  path: string;
  bytes: Uint8Array;
}

const withoutTopFolder = (name: string) => name.split('/').slice(1).join('/');

// A repository zipball has one top-level folder ("owner-repo-<sha>/"); strip it.
//
// With `accept` (asked per file, by its path and the size it will have once inflated) only the files it takes are inflated — and
// they are inflated here, in one go, not by fflate's worker threads: the async form starts a thread per larger file, each holding
// its own copy of the data, and a repository with a hundred binary files took bridge past its memory limit (the kernel killed it).
export async function readZipball(
  data: Uint8Array,
  accept?: (path: string, size: number) => boolean,
): Promise<SnapshotFile[]> {
  if (accept) {
    const picked = unzipSync(data, {
      filter: (file) => {
        if (file.name.endsWith('/')) return false;

        const path = withoutTopFolder(file.name);

        return path !== '' && accept(path, file.originalSize);
      },
    });

    return Object.entries(picked).map(([name, bytes]) => ({
      path: withoutTopFolder(name),
      bytes,
    }));
  }

  const entries = await unzipAsync(data);
  const files: SnapshotFile[] = [];

  for (const [name, bytes] of Object.entries(entries)) {
    if (name.endsWith('/')) continue;

    const path = name.split('/').slice(1).join('/');

    if (path) files.push({ path, bytes });
  }

  return files;
}
