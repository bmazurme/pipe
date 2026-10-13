import { createReadStream } from 'fs';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'path';
import type { Readable } from 'stream';

import { FileMissingError, FileStore } from './file-store';

// The directory bridge always used (`uploads/` next to the process), now behind the same interface as S3.
export class LocalFileStore implements FileStore {
  readonly driver = 'local' as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  localPath(key: string): string {
    const path = resolve(this.root, key);
    const inside = relative(this.root, path);

    // A key comes from our own database, but a path that climbs out of the root is never right.
    if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
      throw new Error(`Refusing the file key ${JSON.stringify(key)}`);
    }

    return path;
  }

  async adopt(key: string, stagedPath: string): Promise<void> {
    const target = this.localPath(key);

    if (resolve(stagedPath) === target) return;

    await mkdir(dirname(target), { recursive: true });
    await rename(stagedPath, target);
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    const target = this.localPath(key);

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  async stat(key: string): Promise<{ size: number } | null> {
    try {
      return { size: (await stat(this.localPath(key))).size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async openRead(key: string): Promise<Readable> {
    if (!(await this.stat(key))) throw new FileMissingError(key);

    return createReadStream(this.localPath(key));
  }

  async readBytes(key: string): Promise<Buffer> {
    try {
      return await readFile(this.localPath(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new FileMissingError(key);
      }
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(this.localPath(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
