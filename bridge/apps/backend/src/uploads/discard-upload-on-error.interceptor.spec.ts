import { BadRequestException, Logger } from '@nestjs/common';
import { mkdtemp, writeFile, access } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { lastValueFrom, of, throwError } from 'rxjs';

import { DiscardUploadOnErrorInterceptor } from './discard-upload-on-error.interceptor';

const ctx = (file?: { path: string }) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ file }) }),
  }) as never;

describe('DiscardUploadOnErrorInterceptor', () => {
  const interceptor = new DiscardUploadOnErrorInterceptor();

  it('removes the uploaded file and rethrows the original error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'discard-'));
    const path = join(dir, 'f.bin');
    await writeFile(path, 'x');
    const err = new BadRequestException('bad');

    await expect(
      lastValueFrom(
        interceptor.intercept(ctx({ path }), {
          handle: () => throwError(() => err),
        }),
      ),
    ).rejects.toBe(err);
    await expect(access(path)).rejects.toBeDefined();
  });

  it('keeps the file on success', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'discard-'));
    const path = join(dir, 'f.bin');
    await writeFile(path, 'x');

    await lastValueFrom(
      interceptor.intercept(ctx({ path }), { handle: () => of(1) }),
    );
    await expect(access(path)).resolves.toBeUndefined();
  });

  it('warns and still rethrows the original error if removal fails', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const err = new BadRequestException('bad');
    // a path under a regular file makes rm fail with ENOTDIR
    const dir = await mkdtemp(join(tmpdir(), 'discard-'));
    const file = join(dir, 'f');
    await writeFile(file, 'x');

    await expect(
      lastValueFrom(
        interceptor.intercept(ctx({ path: join(file, 'child') }), {
          handle: () => throwError(() => err),
        }),
      ),
    ).rejects.toBe(err);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
