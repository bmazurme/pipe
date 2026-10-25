import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import {
  generateEnrollCode,
  generateWorkerKey,
  hashSecret,
} from '../auth/worker-keys.service';
import {
  CreateWorkerDto,
  CreatedWorkerResponseDto,
  DeletedWorkerResponseDto,
  EnrollWorkerDto,
  EnrolledWorkerResponseDto,
  UpdateWorkerDto,
  WorkerConfigResponseDto,
  WorkerResponseDto,
} from './dto/worker-fleet.dto';
import { parseVlessLink } from './vless-link';
import { touchWorker } from './worker-touch';
import { ClaudeCredential } from './entities/claude-credential.entity';
import { Job, JobStatus } from './entities/job.entity';
import { Worker } from './entities/worker.entity';
import {
  STALE_AFTER_MS,
  WorkerHeartbeatService,
} from './worker-heartbeat.service';

// How long a freshly issued enrollment code can be redeemed.
export const ENROLL_TTL_MS = 30 * 60 * 1000;

export const WORKER_DELETED_MESSAGE =
  'The worker was deleted by the owner while it was running this job — run it again';

const ACTIVE_STATUSES = [JobStatus.Claimed, JobStatus.Running];

@Injectable()
export class WorkersService {
  constructor(
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    @InjectRepository(Job)
    private readonly jobs: Repository<Job>,
    @InjectRepository(ClaudeCredential)
    private readonly credentials: Repository<ClaudeCredential>,
    private readonly heartbeats: WorkerHeartbeatService,
  ) {}

  // A worker can only be bound to one of the owner's own tokens.
  private async assertCredentialOwned(
    userId: number,
    credentialId: number | null | undefined,
  ): Promise<void> {
    if (credentialId === null || credentialId === undefined) return;

    if (!(await this.credentials.existsBy({ id: credentialId, userId }))) {
      throw new BadRequestException('Claude token not found');
    }
  }

  // '' or null clears; anything else must be a link the worker can run a tunnel with.
  private normalizeVpnLink(raw: string | null | undefined): string | null {
    const link = raw?.trim() ?? '';

    if (link === '') return null;

    try {
      parseVlessLink(link);
    } catch (error) {
      throw new BadRequestException(
        `VPN: ${error instanceof Error ? error.message : 'неверная ссылка'}`,
      );
    }

    return link;
  }

  // The token a worker was bound to in its settings (null = none).
  async claudeCredentialIdOf(workerId: number): Promise<number | null> {
    const worker = await this.workers.findOne({
      where: { id: workerId },
      select: { id: true, claudeCredentialId: true },
    });

    return worker?.claudeCredentialId ?? null;
  }

  private isOnline(lastSeenAt: Date | null, now = Date.now()): boolean {
    return lastSeenAt !== null && now - lastSeenAt.getTime() < STALE_AFTER_MS;
  }

  private async activeJobCounts(
    userId: number,
  ): Promise<{ byId: Map<number, number>; byName: Map<string, number> }> {
    const rows = await this.jobs
      .createQueryBuilder('job')
      .select('job.workerId', 'workerId')
      .addSelect('job.workerName', 'workerName')
      .addSelect('COUNT(*)', 'count')
      .where('job.userId = :userId', { userId })
      .andWhere('job.status IN (:...statuses)', { statuses: ACTIVE_STATUSES })
      .groupBy('job.workerId')
      .addGroupBy('job.workerName')
      .getRawMany<{
        workerId: number | null;
        workerName: string | null;
        count: string;
      }>();
    const byId = new Map<number, number>();
    const byName = new Map<string, number>();

    for (const row of rows) {
      const count = Number(row.count);

      if (row.workerId !== null) {
        byId.set(row.workerId, (byId.get(row.workerId) ?? 0) + count);
      } else if (row.workerName) {
        byName.set(row.workerName, (byName.get(row.workerName) ?? 0) + count);
      }
    }

    return { byId, byName };
  }

  // The workers the owner added, plus the ones that still authenticate with a personal API key (known only by the
  // name they report) — so nothing that is running is hidden from the page.
  async list(userId: number): Promise<WorkerResponseDto[]> {
    const now = new Date();
    const [managed, legacy, counts] = await Promise.all([
      this.workers.find({ where: { userId }, order: { id: 'ASC' } }),
      this.heartbeats.listForUser(userId),
      this.activeJobCounts(userId),
    ]);
    const managedNames = new Set(managed.map((worker) => worker.name));

    return [
      ...managed.map((worker) =>
        WorkerResponseDto.fromWorker(
          worker,
          counts.byId.get(worker.id) ?? 0,
          this.isOnline(worker.lastSeenAt, now.getTime()),
          now,
        ),
      ),
      ...legacy
        .filter((entry) => !managedNames.has(entry.name))
        .map((entry) =>
          WorkerResponseDto.legacy(
            entry.name,
            entry.lastSeenAt,
            counts.byName.get(entry.name) ?? 0,
            entry.isUp,
          ),
        ),
    ];
  }

  // What the app shell's "is some worker up" poll needs, without the full worker list: no jobs aggregate, and only
  // the columns it reads (so the encrypted vpnLink is never decrypted). Same answer as list() for these fields.
  async upHeartbeats(
    userId: number,
  ): Promise<{ name: string; lastSeenAt: Date; isUp: boolean }[]> {
    const now = Date.now();
    const [managed, legacy] = await Promise.all([
      this.workers.find({
        where: { userId },
        select: {
          id: true,
          name: true,
          enabled: true,
          keyHash: true,
          lastSeenAt: true,
        },
        order: { id: 'ASC' },
      }),
      this.heartbeats.listForUser(userId),
    ]);
    const managedNames = new Set(managed.map((worker) => worker.name));

    return [
      ...managed.flatMap((worker) =>
        worker.lastSeenAt
          ? [
              {
                name: worker.name,
                lastSeenAt: worker.lastSeenAt,
                isUp:
                  worker.keyHash !== null &&
                  worker.enabled &&
                  this.isOnline(worker.lastSeenAt, now),
              },
            ]
          : [],
      ),
      ...legacy
        .filter((entry) => !managedNames.has(entry.name))
        .map((entry) => ({
          name: entry.name,
          lastSeenAt: entry.lastSeenAt,
          isUp: entry.isUp,
        })),
    ];
  }

  async findOwned(id: number, userId: number): Promise<Worker> {
    const worker = await this.workers.findOneBy({ id, userId });

    if (!worker) {
      throw new NotFoundException('Worker not found');
    }

    return worker;
  }

  private async assertNameFree(
    userId: number,
    name: string,
    exceptId?: number,
  ): Promise<void> {
    const existing = await this.workers.findOneBy({ userId, name });

    if (existing && existing.id !== exceptId) {
      throw new ConflictException(`A worker named "${name}" already exists`);
    }
  }

  async create(
    userId: number,
    dto: CreateWorkerDto,
  ): Promise<CreatedWorkerResponseDto> {
    const name = dto.name.trim();

    await this.assertNameFree(userId, name);
    await this.assertCredentialOwned(userId, dto.claudeCredentialId);

    const { code, hash } = generateEnrollCode();
    const expires = new Date(Date.now() + ENROLL_TTL_MS);
    const worker = await this.workers.save(
      this.workers.create({
        userId,
        name,
        enabled: true,
        keyHash: null,
        keyPrefix: null,
        enrollCodeHash: hash,
        enrollExpiresAt: expires,
        models: dto.models ?? null,
        pollIntervalSec: dto.pollIntervalSec ?? 10,
        jobTimeoutSec: dto.jobTimeoutSec ?? 1800,
        proxyUrl: dto.proxyUrl?.trim() || null,
        chatEnabled: dto.chatEnabled ?? true,
        claudeCredentialId: dto.claudeCredentialId ?? null,
        vpnLink: this.normalizeVpnLink(dto.vpnLink),
        capabilities: dto.capabilities?.length ? dto.capabilities : null,
      }),
    );

    return {
      worker: WorkerResponseDto.fromWorker(worker, 0, false, new Date()),
      enrollCode: code,
      enrollExpiresAt: expires,
    };
  }

  async update(
    id: number,
    userId: number,
    dto: UpdateWorkerDto,
  ): Promise<WorkerResponseDto> {
    const worker = await this.findOwned(id, userId);

    if (dto.name !== undefined) {
      const name = dto.name.trim();

      await this.assertNameFree(userId, name, worker.id);
      worker.name = name;
    }
    if (dto.enabled !== undefined) worker.enabled = dto.enabled;
    if (dto.models !== undefined) worker.models = dto.models;
    if (dto.pollIntervalSec !== undefined)
      worker.pollIntervalSec = dto.pollIntervalSec;
    if (dto.jobTimeoutSec !== undefined)
      worker.jobTimeoutSec = dto.jobTimeoutSec;
    if (dto.proxyUrl !== undefined)
      worker.proxyUrl = dto.proxyUrl?.trim() || null;
    if (dto.chatEnabled !== undefined) worker.chatEnabled = dto.chatEnabled;
    if (dto.claudeCredentialId !== undefined) {
      await this.assertCredentialOwned(userId, dto.claudeCredentialId);
      worker.claudeCredentialId = dto.claudeCredentialId;
    }
    if (dto.limitsRefreshMin !== undefined) {
      worker.limitsRefreshMin = dto.limitsRefreshMin;
    }
    if (dto.vpnLink !== undefined) {
      worker.vpnLink = this.normalizeVpnLink(dto.vpnLink);
    }
    if (dto.capabilities !== undefined) {
      worker.capabilities = dto.capabilities.length ? dto.capabilities : null;
    }

    const saved = await this.workers.save(worker);
    const counts = await this.activeJobCounts(userId);

    return WorkerResponseDto.fromWorker(
      saved,
      counts.byId.get(saved.id) ?? 0,
      this.isOnline(saved.lastSeenAt),
      new Date(),
    );
  }

  // "Refresh limits": the worker notices on its next settings fetch and probes once. Only an enrolled worker can answer.
  async requestLimitsRefresh(id: number, userId: number): Promise<void> {
    const worker = await this.findOwned(id, userId);

    if (worker.keyHash === null) {
      throw new ConflictException('The worker is not connected yet');
    }

    worker.limitsRefreshRequestedAt = new Date();
    await this.workers.save(worker);
  }

  // Connect (or reconnect) a worker: a new one-time code. If the worker was already enrolled its old key stops working
  // now, so a lost or copied key is revoked by simply enrolling again.
  async renewEnrollment(
    id: number,
    userId: number,
  ): Promise<CreatedWorkerResponseDto> {
    const worker = await this.findOwned(id, userId);
    const { code, hash } = generateEnrollCode();
    const expires = new Date(Date.now() + ENROLL_TTL_MS);

    worker.enrollCodeHash = hash;
    worker.enrollExpiresAt = expires;
    worker.keyHash = null;
    worker.keyPrefix = null;

    const saved = await this.workers.save(worker);

    return {
      worker: WorkerResponseDto.fromWorker(saved, 0, false, new Date()),
      enrollCode: code,
      enrollExpiresAt: expires,
    };
  }

  // The worker presents the code it was given; in return it gets its own key, once. The code is single-use.
  async enroll(dto: EnrollWorkerDto): Promise<EnrolledWorkerResponseDto> {
    const { key, prefix, hash } = generateWorkerKey();
    const hostname = dto.hostname?.trim();
    const version = dto.version?.trim();

    // One conditional UPDATE (compare-and-set): of two concurrent redemptions of the same code
    // only one matches the row, the other updates nothing and is refused.
    const result = await this.workers
      .createQueryBuilder()
      .update(Worker)
      .set({
        keyHash: hash,
        keyPrefix: prefix,
        enrollCodeHash: null,
        enrollExpiresAt: null,
        lastSeenAt: new Date(),
        ...(hostname ? { hostname } : {}),
        ...(version ? { version } : {}),
      })
      .where('"enrollCodeHash" = :codeHash AND "enrollExpiresAt" > now()', {
        codeHash: hashSecret(dto.code.trim()),
      })
      .returning(['id', 'name'])
      .execute();

    const worker = (
      result.raw as { id: number; name: string }[] | undefined
    )?.[0];

    if (!result.affected || !worker) {
      throw new UnauthorizedException('Invalid or expired enrollment code');
    }

    return { workerId: worker.id, name: worker.name, key };
  }

  // Deleting a worker revokes its key at once (its next call is refused), fails what it was running, and frees any
  // queued job that was pinned to it (the pin disappears with the row).
  async remove(id: number, userId: number): Promise<DeletedWorkerResponseDto> {
    const worker = await this.findOwned(id, userId);

    return this.workers.manager.transaction(async (manager) => {
      const failed = await manager
        .createQueryBuilder()
        .update(Job)
        .set({
          status: JobStatus.Failed,
          errorMessage: WORKER_DELETED_MESSAGE,
          finishedAt: () => 'now()',
          logs: () => `logs || '\nFailed: ' || :message || '\n'`,
        })
        .where({ workerId: worker.id, status: In(ACTIVE_STATUSES) })
        .setParameter('message', WORKER_DELETED_MESSAGE)
        .execute();

      await manager.delete(Worker, { id: worker.id });

      return { failedJobs: failed.affected ?? 0 };
    });
  }

  // Hides a legacy worker's row (it reappears if that process keeps polling).
  async forgetLegacy(userId: number, name: string): Promise<void> {
    await this.heartbeats.forget(userId, name);
  }

  // Called on every worker request that proves it is alive.
  async touch(workerId: number): Promise<void> {
    await touchWorker(this.workers, workerId);
  }

  async configFor(workerId: number): Promise<WorkerConfigResponseDto> {
    const worker = await this.workers.findOneBy({ id: workerId });

    if (!worker) {
      throw new UnauthorizedException('Invalid or revoked worker key');
    }

    await touchWorker(this.workers, worker.id, worker.lastSeenAt);

    return {
      id: worker.id,
      name: worker.name,
      enabled: worker.enabled,
      models: worker.models,
      pollIntervalSec: worker.pollIntervalSec,
      jobTimeoutSec: worker.jobTimeoutSec,
      proxyUrl: worker.proxyUrl,
      chatEnabled: worker.chatEnabled,
      vpnLink: worker.vpnLink ?? null,
      limitsRefreshMin: worker.limitsRefreshMin ?? 0,
      limitsRefreshRequestedAt: worker.limitsRefreshRequestedAt ?? null,
      limitProbe: null,
      capabilities: worker.capabilities ?? [],
    };
  }

  // The worker's own settings fetch. A personal API key has no worker behind it (a legacy worker keeps using its
  // environment), so it gets a clear refusal rather than someone else's settings.
  async configForPrincipal(principal: {
    id: number;
    workerId?: number;
  }): Promise<WorkerConfigResponseDto> {
    if (principal.workerId === undefined) {
      throw new UnauthorizedException('This call needs a worker key');
    }

    return this.configFor(principal.workerId);
  }

  // May this worker take a chat turn right now? Also counts as a sign of life.
  async mayTakeChatTurn(workerId: number): Promise<boolean> {
    const worker = await this.workers.findOneBy({ id: workerId });

    if (!worker) return false;

    await touchWorker(this.workers, worker.id, worker.lastSeenAt);

    return worker.enabled && worker.chatEnabled;
  }

  async findById(workerId: number): Promise<Worker | null> {
    return this.workers.findOneBy({ id: workerId });
  }
}
