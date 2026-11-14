import { randomUUID } from 'crypto';
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'fs/promises';
import { basename, dirname, join } from 'path';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { unzipBounded } from '../common/zip';
import { FILE_STORE, type FileStore } from '../storage/file-store/file-store';
import { PromoLandingRelease } from './entities/promo-landing-release.entity';
import {
  LANDING_KEEP_RELEASES,
  LANDING_LIMITS,
  LANDING_MAX_ZIP_BYTES,
  type LandingFile,
  releaseDirName,
  releaseFiles,
} from './landing-files';

export interface LandingReleaseView {
  id: number;
  label: string;
  dirName: string;
  fileCount: number;
  sizeBytes: number;
  createdAt: Date;
  activatedAt: Date | null;
  active: boolean;
}

export interface LandingState {
  // false when LANDING_DIR is not set (a dev machine): the rest is then empty.
  configured: boolean;
  url: string | null;
  // The release `current` points at, by directory name — also a release that did not come through this module (a script's one).
  activeDirName: string | null;
  releases: LandingReleaseView[];
}

const releaseKey = (storedName: string) => `promo/${storedName}`;

// The landing page, served by Caddy from the `landing_site` volume that this backend can write to. The volume holds
//   releases/<dirName>/…   one directory per uploaded version
//   current                a symlink to the live one
// so switching versions (and going back) is one atomic rename of the symlink, and a visitor never sees a half-written site.
// The zip of every release stays in the FileStore: the volume is only a cache of it, and a board that starts with an empty
// volume (after a failover) unpacks the last live release again.
@Injectable()
export class PromoLandingService implements OnModuleInit {
  private readonly logger = new Logger(PromoLandingService.name);

  // Releases are switched one at a time: two uploads or an upload and an activation must not interleave their renames.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    @InjectRepository(PromoLandingRelease)
    private readonly releases: Repository<PromoLandingRelease>,
    @Inject(FILE_STORE) private readonly store: FileStore,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Best effort: a problem with the volume must never keep bridge itself from starting.
    try {
      await this.serial(() => this.ensureCurrent());
    } catch (error) {
      this.logger.warn(`Landing volume check failed: ${String(error)}`);
    }
  }

  isConfigured(): boolean {
    return Boolean(this.root());
  }

  async state(): Promise<LandingState> {
    const root = this.root();

    if (!root) {
      return {
        configured: false,
        url: null,
        activeDirName: null,
        releases: [],
      };
    }

    const activeDirName = await this.activeDirName(root);
    const rows = await this.releases.find({ order: { id: 'DESC' } });

    return {
      configured: true,
      url: this.config.get<string>('LANDING_URL') || null,
      activeDirName,
      releases: rows.map((row) => this.view(row, activeDirName)),
    };
  }

  // The zip becomes a release that is NOT live yet: switching it on is a separate, deliberate step.
  async upload(
    file: Express.Multer.File,
    label?: string,
  ): Promise<LandingReleaseView> {
    const staged = file.path;

    try {
      const root = this.requireRoot();
      const bytes = await readFile(staged);

      if (bytes.length > LANDING_MAX_ZIP_BYTES) {
        throw new BadRequestException('Архив больше 50 МБ');
      }

      let files: LandingFile[];

      try {
        files = releaseFiles(await unzipBounded(bytes, LANDING_LIMITS));
      } catch (error) {
        throw new BadRequestException(
          error instanceof Error ? error.message : 'Не удалось прочитать архив',
        );
      }

      return await this.serial(async () => {
        const dirName = releaseDirName(new Date(), randomUUID().slice(0, 8));
        const storedName = `landing/${randomUUID()}.zip`;

        await this.store.put(releaseKey(storedName), bytes);

        try {
          await this.writeRelease(root, dirName, files);

          const row = await this.releases.save(
            this.releases.create({
              label: (
                label?.trim() || file.originalname.replace(/\.zip$/i, '')
              ).slice(0, 120),
              storedName,
              dirName,
              fileCount: files.length,
              sizeBytes: files.reduce((sum, f) => sum + f.bytes.length, 0),
              activatedAt: null,
            }),
          );

          return this.view(row, await this.activeDirName(root));
        } catch (error) {
          await this.store
            .remove(releaseKey(storedName))
            .catch(() => undefined);
          await rm(join(root, 'releases', dirName), {
            recursive: true,
            force: true,
          });
          throw error;
        }
      });
    } finally {
      await unlink(staged).catch(() => undefined);
    }
  }

  // Makes a release the live site (also the way back to an earlier one).
  activate(id: number): Promise<LandingReleaseView> {
    const root = this.requireRoot();

    return this.serial(async () => {
      const row = await this.get(id);

      await this.ensureUnpacked(root, row);
      await this.pointCurrentAt(root, row.dirName);
      row.activatedAt = new Date();
      await this.releases.save(row);
      await this.prune(root, row.id);

      return this.view(row, row.dirName);
    });
  }

  remove(id: number): Promise<void> {
    const root = this.requireRoot();

    return this.serial(async () => {
      const row = await this.get(id);

      if ((await this.activeDirName(root)) === row.dirName) {
        throw new ConflictException(
          'Этот релиз сейчас на сайте: сначала включите другой',
        );
      }

      await this.drop(root, row);
    });
  }

  // --- internals

  private root(): string | undefined {
    return this.config.get<string>('LANDING_DIR') || undefined;
  }

  private requireRoot(): string {
    const root = this.root();

    if (!root) {
      throw new ServiceUnavailableException(
        'Лендинг не настроен: на этом bridge не задан LANDING_DIR',
      );
    }

    return root;
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);

    this.queue = run.then(
      () => undefined,
      () => undefined,
    );

    return run;
  }

  private async get(id: number): Promise<PromoLandingRelease> {
    const row = await this.releases.findOne({ where: { id } });

    if (!row) throw new NotFoundException('Релиз не найден');

    return row;
  }

  private view(
    row: PromoLandingRelease,
    activeDirName: string | null,
  ): LandingReleaseView {
    return {
      id: row.id,
      label: row.label,
      dirName: row.dirName,
      fileCount: row.fileCount,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt,
      activatedAt: row.activatedAt,
      active: row.dirName === activeDirName,
    };
  }

  private async activeDirName(root: string): Promise<string | null> {
    try {
      return basename(await readlink(join(root, 'current')));
    } catch {
      return null;
    }
  }

  // Written next to the final place and renamed into it, so a crash leaves a .tmp directory, never a half release.
  private async writeRelease(
    root: string,
    dirName: string,
    files: LandingFile[],
  ): Promise<void> {
    const releases = join(root, 'releases');
    const tmp = join(releases, `.tmp-${randomUUID()}`);

    try {
      for (const file of files) {
        const target = join(tmp, file.path);

        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.bytes);
      }

      await rename(tmp, join(releases, dirName));
    } catch (error) {
      await rm(tmp, { recursive: true, force: true });
      throw error;
    }
  }

  // The directory is a cache: gone (a new volume), it is unpacked again from the zip in the store.
  private async ensureUnpacked(
    root: string,
    row: PromoLandingRelease,
  ): Promise<void> {
    const index = join(root, 'releases', row.dirName, 'index.html');

    if (
      await stat(index).then(
        () => true,
        () => false,
      )
    )
      return;

    const bytes = await this.store.readBytes(releaseKey(row.storedName));
    const files = releaseFiles(await unzipBounded(bytes, LANDING_LIMITS));

    await rm(join(root, 'releases', row.dirName), {
      recursive: true,
      force: true,
    });
    await this.writeRelease(root, row.dirName, files);
  }

  private async pointCurrentAt(root: string, dirName: string): Promise<void> {
    const tmp = join(root, `.current-${randomUUID()}`);

    await symlink(join('releases', dirName), tmp);

    try {
      await rename(tmp, join(root, 'current'));
    } catch (error) {
      await unlink(tmp).catch(() => undefined);
      throw error;
    }
  }

  // Keeps the newest few releases (and the live one, whatever its age); the rest go with their zips.
  private async prune(root: string, keepId: number): Promise<void> {
    const active = await this.activeDirName(root);
    const rows = await this.releases.find({ order: { id: 'DESC' } });

    for (const row of rows.slice(LANDING_KEEP_RELEASES)) {
      if (row.id === keepId || row.dirName === active) continue;

      await this.drop(root, row);
    }
  }

  private async drop(root: string, row: PromoLandingRelease): Promise<void> {
    await rm(join(root, 'releases', row.dirName), {
      recursive: true,
      force: true,
    });
    await this.store.remove(releaseKey(row.storedName)).catch(() => undefined);
    await this.releases.remove(row);
  }

  // At start: make sure there is a live site to serve.
  //  - `current` already there: nothing to do;
  //  - the old flat layout (deploy-landing.sh used to put index.html straight into the volume): moved into releases/legacy;
  //  - an empty volume but a release switched on before (a new board after a failover): unpacked again from the store.
  private async ensureCurrent(): Promise<void> {
    const root = this.root();

    if (!root) return;

    await mkdir(join(root, 'releases'), { recursive: true });

    if (
      await lstat(join(root, 'current')).then(
        () => true,
        () => false,
      )
    )
      return;

    if (
      await stat(join(root, 'index.html')).then(
        () => true,
        () => false,
      )
    ) {
      const legacy = join(root, 'releases', 'legacy');

      await rm(legacy, { recursive: true, force: true });
      await mkdir(legacy, { recursive: true });

      for (const name of await readdir(root)) {
        if (name === 'releases' || name.startsWith('.')) continue;

        await rename(join(root, name), join(legacy, name));
      }

      await this.pointCurrentAt(root, 'legacy');
      this.logger.log('Landing: the flat site moved to releases/legacy');

      return;
    }

    const last = await this.releases.findOne({
      where: {},
      order: { activatedAt: { direction: 'DESC', nulls: 'LAST' } },
    });

    if (last?.activatedAt) {
      await this.ensureUnpacked(root, last);
      await this.pointCurrentAt(root, last.dirName);
      this.logger.log(`Landing: unpacked ${last.dirName} from the store`);
    }
  }
}
