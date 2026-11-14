import {
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  rm,
  stat,
  writeFile,
} from 'fs/promises';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { zipSync } from 'fflate';
import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';

import type { PromoLandingRelease } from './entities/promo-landing-release.entity';
import { PromoLandingService } from './promo-landing.service';

// A repository that keeps rows in memory: only what the service uses.
class MemoryRepo {
  rows: PromoLandingRelease[] = [];
  private nextId = 1;

  create(data: Partial<PromoLandingRelease>): PromoLandingRelease {
    return { ...data } as PromoLandingRelease;
  }

  async save(row: PromoLandingRelease): Promise<PromoLandingRelease> {
    if (!row.id) {
      row.id = this.nextId++;
      row.createdAt = new Date();
      this.rows.push(row);
    }

    return row;
  }

  async remove(row: PromoLandingRelease): Promise<void> {
    this.rows = this.rows.filter((r) => r.id !== row.id);
  }

  async find(): Promise<PromoLandingRelease[]> {
    return [...this.rows].sort((a, b) => b.id - a.id);
  }

  async findOne(options: {
    where: { id?: number };
  }): Promise<PromoLandingRelease | null> {
    if (options.where.id !== undefined) {
      return this.rows.find((r) => r.id === options.where.id) ?? null;
    }

    // the most recently activated one
    return (
      [...this.rows]
        .filter((r) => r.activatedAt)
        .sort(
          (a, b) => b.activatedAt!.getTime() - a.activatedAt!.getTime(),
        )[0] ??
      this.rows[0] ??
      null
    );
  }
}

class MemoryStore {
  files = new Map<string, Buffer>();
  readonly driver = 'local' as const;

  async put(key: string, bytes: Buffer) {
    this.files.set(key, bytes);
  }

  async readBytes(key: string) {
    const bytes = this.files.get(key);

    if (!bytes) throw new Error(`missing ${key}`);

    return bytes;
  }

  async remove(key: string) {
    this.files.delete(key);
  }
}

const text = (s: string) => new TextEncoder().encode(s);

describe('PromoLandingService', () => {
  let root: string;
  let staging: string;
  let repo: MemoryRepo;
  let store: MemoryStore;

  const make = (landingDir: string | undefined = root) =>
    new PromoLandingService(
      repo as never,
      store as never,
      {
        get: (key: string) =>
          key === 'LANDING_DIR'
            ? landingDir
            : key === 'LANDING_URL'
              ? 'https://landing.example'
              : undefined,
      } as never,
    );

  // A multer file: the archive written to a staging directory.
  async function upload(
    service: PromoLandingService,
    entries: Record<string, Uint8Array>,
    label?: string,
  ) {
    const path = join(staging, `${Math.random().toString(36).slice(2)}.zip`);

    await writeFile(path, zipSync(entries));

    return service.upload(
      { path, originalname: 'site.zip' } as Express.Multer.File,
      label,
    );
  }

  const site = (title: string) => ({
    'index.html': text(`<h1>${title}</h1>`),
    'img/a.png': text('png'),
  });
  const live = async () => basename(await readlink(join(root, 'current')));

  beforeEach(async () => {
    const base = await mkdtemp(join(tmpdir(), 'promo-landing-'));

    root = join(base, 'landing');
    staging = join(base, 'staging');
    await mkdir(root, { recursive: true });
    await mkdir(staging, { recursive: true });
    repo = new MemoryRepo();
    store = new MemoryStore();
  });

  afterEach(async () => {
    await rm(join(root, '..'), { recursive: true, force: true });
  });

  it('is not configured without LANDING_DIR', async () => {
    const service = make('');

    expect(service.isConfigured()).toBe(false);
    expect(await service.state()).toMatchObject({
      configured: false,
      releases: [],
    });
    await expect(upload(service, site('x'))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('uploads a release without making it live, keeps the zip, and removes the staged file', async () => {
    const service = make();
    const release = await upload(service, site('v1'), 'Первая');

    expect(release).toMatchObject({
      label: 'Первая',
      fileCount: 2,
      active: false,
      activatedAt: null,
    });
    expect(
      await readFile(
        join(root, 'releases', release.dirName, 'index.html'),
        'utf8',
      ),
    ).toBe('<h1>v1</h1>');
    expect(
      await readFile(
        join(root, 'releases', release.dirName, 'img/a.png'),
        'utf8',
      ),
    ).toBe('png');
    expect([...store.files.keys()][0]).toMatch(/^promo\/landing\/.+\.zip$/);
    expect(await readdir(staging)).toEqual([]);
    await expect(readlink(join(root, 'current'))).rejects.toThrow();
  });

  it('switches the live site with activate and goes back to an earlier release', async () => {
    const service = make();
    const first = await upload(service, site('v1'));
    const second = await upload(service, site('v2'));

    await service.activate(first.id);
    expect(await live()).toBe(first.dirName);

    const view = await service.activate(second.id);

    expect(view.active).toBe(true);
    expect(await live()).toBe(second.dirName);
    expect(await readFile(join(root, 'current', 'index.html'), 'utf8')).toBe(
      '<h1>v2</h1>',
    );

    await service.activate(first.id);
    expect(await readFile(join(root, 'current', 'index.html'), 'utf8')).toBe(
      '<h1>v1</h1>',
    );
    expect((await service.state()).activeDirName).toBe(first.dirName);
  });

  it('will not delete the live release, but deletes another one with its zip', async () => {
    const service = make();
    const first = await upload(service, site('v1'));
    const second = await upload(service, site('v2'));

    await service.activate(first.id);
    await expect(service.remove(first.id)).rejects.toBeInstanceOf(
      ConflictException,
    );

    await service.remove(second.id);
    expect(repo.rows.map((r) => r.id)).toEqual([first.id]);
    expect(store.files.size).toBe(1);
    await expect(
      stat(join(root, 'releases', second.dirName)),
    ).rejects.toThrow();
  });

  it.each([
    ['no index.html', { 'a.html': text('x') }, /index\.html/],
    [
      'a path that leaves the folder',
      { 'index.html': text('x'), '../evil.html': text('x') },
      /выходит/,
    ],
    [
      'a type off the allowlist',
      { 'index.html': text('x'), 'shell.php': text('x') },
      /не разрешён/,
    ],
  ])(
    'refuses an archive with %s and leaves nothing behind',
    async (_name, entries, message) => {
      const service = make();

      await expect(upload(service, entries)).rejects.toThrow(message);
      await expect(upload(service, entries)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repo.rows).toEqual([]);
      expect(store.files.size).toBe(0);
      expect(await readdir(staging)).toEqual([]);
      expect(await readdir(root)).toEqual([]);
    },
  );

  it('refuses something that is not a zip', async () => {
    const service = make();
    const path = join(staging, 'bad.zip');

    await writeFile(path, 'not a zip');
    await expect(
      service.upload({ path, originalname: 'bad.zip' } as Express.Multer.File),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await readdir(staging)).toEqual([]);
  });

  it('keeps the newest five releases and never drops the live one', async () => {
    const service = make();
    const made = [];

    for (let i = 1; i <= 7; i++)
      made.push(await upload(service, site(`v${i}`)));

    await service.activate(made[0].id); // the oldest goes live
    await service.activate(made[6].id);
    expect(
      (await service.state()).releases.map((r) => r.id).sort((a, b) => a - b),
    ).toEqual([3, 4, 5, 6, 7]);

    await service.activate(made[2].id); // 3, an old one, is live; the next activation prunes around it
    await upload(service, site('v8'));
    await service.activate(8);

    const ids = (await service.state()).releases
      .map((r) => r.id)
      .sort((a, b) => a - b);

    expect(ids).toEqual([4, 5, 6, 7, 8]);
  });

  describe('at start', () => {
    it('moves the old flat site (put there by deploy-landing.sh) into releases/legacy and serves it', async () => {
      await writeFile(join(root, 'index.html'), '<h1>flat</h1>');
      await mkdir(join(root, 'fonts'));
      await writeFile(join(root, 'fonts', 'a.woff2'), 'f');

      await make().onModuleInit();

      expect(await live()).toBe('legacy');
      expect(await readFile(join(root, 'current', 'index.html'), 'utf8')).toBe(
        '<h1>flat</h1>',
      );
      expect(
        await readFile(join(root, 'current', 'fonts', 'a.woff2'), 'utf8'),
      ).toBe('f');
      await expect(stat(join(root, 'index.html'))).rejects.toThrow();
    });

    it('leaves a live site alone', async () => {
      const service = make();
      const first = await upload(service, site('v1'));

      await service.activate(first.id);
      await make().onModuleInit();

      expect(await live()).toBe(first.dirName);
    });

    it('unpacks the last live release again on an empty volume (a board after a failover)', async () => {
      const service = make();
      const first = await upload(service, site('v1'));

      await service.activate(first.id);
      // a new board: the volume is empty, the database and the store are not
      await rm(root, { recursive: true, force: true });
      await mkdir(root, { recursive: true });

      await make().onModuleInit();

      expect(await live()).toBe(first.dirName);
      expect(await readFile(join(root, 'current', 'index.html'), 'utf8')).toBe(
        '<h1>v1</h1>',
      );
    });

    it('does nothing, and does not throw, on an empty volume with no release', async () => {
      await expect(make().onModuleInit()).resolves.toBeUndefined();
      expect(await readdir(root)).toEqual(['releases']);
    });

    it('does not throw when the volume is broken', async () => {
      await expect(
        make(join(root, 'index.html', 'x')).onModuleInit(),
      ).resolves.toBeUndefined();
    });
  });
});
