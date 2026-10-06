import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { StorageService } from '../storage/storage.service';
import {
  StoredFile,
  StoredFileDirection,
} from '../storage/entities/stored-file.entity';
import { ClaudeCredentialsService } from './claude-credentials.service';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobStatusDto } from './dto/update-job-status.dto';
import { Job, JobStatus } from './entities/job.entity';
import { WorkerHeartbeatService } from './worker-heartbeat.service';

const ENCRYPTED_SUFFIX = '.enc';

@Injectable()
export class WorkerService {
  private readonly logger = new Logger(WorkerService.name);

  constructor(
    @InjectRepository(Job)
    private readonly jobRepository: Repository<Job>,
    private readonly storageService: StorageService,
    private readonly claudeCredentialsService: ClaudeCredentialsService,
    private readonly heartbeatService: WorkerHeartbeatService,
  ) {}

  async create(userId: number, dto: CreateJobDto): Promise<Job> {
    const sourceFile = await this.storageService.findOwned(
      dto.sourceFileId,
      userId,
    );

    if (sourceFile.originalName.endsWith(ENCRYPTED_SUFFIX)) {
      throw new BadRequestException(
        'Worker only accepts unencrypted parcels — this file is encrypted',
      );
    }

    if (dto.claudeCredentialId !== undefined) {
      const token = await this.claudeCredentialsService.resolveToken(
        dto.claudeCredentialId,
        userId,
      );
      if (token === null) {
        throw new BadRequestException('Claude credential not found');
      }
    }

    return this.jobRepository.save({
      userId,
      sourceFileId: sourceFile.id,
      model: dto.model,
      claudeCredentialId: dto.claudeCredentialId ?? null,
      status: JobStatus.Queued,
    });
  }

  async findAllByUser(userId: number): Promise<Job[]> {
    return this.jobRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOwned(id: number, userId: number): Promise<Job> {
    const job = await this.jobRepository.findOne({ where: { id, userId } });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    return job;
  }

  async remove(id: number, userId: number): Promise<void> {
    const job = await this.findOwned(id, userId);

    if (job.status === JobStatus.Claimed || job.status === JobStatus.Running) {
      throw new BadRequestException(
        `Cannot remove a job while it's ${job.status} — wait for it to finish`,
      );
    }

    await this.jobRepository.delete(job.id);
  }

  // Atomically takes the oldest queued job for this account — the subquery's
  // FOR UPDATE SKIP LOCKED is what makes this safe against two worker
  // processes polling the same account at once (each gets a different row,
  // or nothing, never the same one).
  async claim(userId: number, workerName?: string): Promise<Job | null> {
    // Recorded unconditionally — this is the actual liveness signal (see
    // WorkerHeartbeatService): a worker polling an empty queue still proves
    // it's alive here even though nothing below changes a single Job row.
    if (workerName) {
      await this.heartbeatService.record(userId, workerName);
    }

    // node-postgres's driver (via TypeORM's Repository.query) returns
    // [rows, affectedCount] for an UPDATE/INSERT/DELETE — even one with a
    // RETURNING clause — not a flat rows array the way a plain SELECT does.
    // Indexing straight into the result ([0]?.id) silently reads the rows
    // array itself as if it were the first row, always finding no `.id` and
    // reporting "nothing to claim" even though the UPDATE just committed.
    const [rows]: [{ id: number }[], number] = await this.jobRepository.query(
      `UPDATE jobs SET status = $1, "claimedAt" = now(), "workerName" = $2, "updatedAt" = now()
       WHERE id = (
         SELECT id FROM jobs WHERE status = $3 AND "userId" = $4
         ORDER BY "createdAt" ASC LIMIT 1 FOR UPDATE SKIP LOCKED
       )
       RETURNING id`,
      [JobStatus.Claimed, workerName ?? null, JobStatus.Queued, userId],
    );

    const claimedId: number | undefined = rows[0]?.id;
    if (claimedId === undefined) return null;

    return this.jobRepository.findOneBy({ id: claimedId });
  }

  async getSourceFile(id: number, userId: number): Promise<StoredFile> {
    const job = await this.findOwned(id, userId);

    if (job.sourceFileId === null) {
      throw new NotFoundException('The source parcel was already consumed');
    }

    return this.storageService.findOwned(job.sourceFileId, userId);
  }

  async getResultFile(id: number, userId: number): Promise<StoredFile> {
    const job = await this.findOwned(id, userId);

    if (job.resultFileId === null) {
      throw new NotFoundException('This job has no result yet');
    }

    return this.storageService.findOwned(job.resultFileId, userId);
  }

  // Resolves an on-disk path for a StoredFile — kept here rather than
  // making the controller reach into StorageService itself for a single
  // method call.
  filePath(file: StoredFile): string {
    return this.storageService.path(file);
  }

  async updateStatus(
    id: number,
    userId: number,
    dto: UpdateJobStatusDto,
  ): Promise<Job> {
    const job = await this.findOwned(id, userId);

    job.status = dto.status;

    if (dto.status === JobStatus.Running && !job.startedAt) {
      job.startedAt = new Date();
    }

    if (dto.status === JobStatus.Failed) {
      job.errorMessage = dto.errorMessage ?? job.errorMessage;
      job.finishedAt = new Date();
    }

    return this.jobRepository.save(job);
  }

  async appendLog(id: number, userId: number, chunk: string): Promise<void> {
    const job = await this.findOwned(id, userId);

    job.logs += chunk;

    await this.jobRepository.save(job);
  }

  async setResult(
    id: number,
    userId: number,
    file: Express.Multer.File,
  ): Promise<Job> {
    const job = await this.findOwned(id, userId);
    // Null only if a result is reported twice for a job whose pipeline
    // parcel the first report already consumed — the result is then simply
    // stored unaddressed rather than failing the report.
    const sourceFile =
      job.sourceFileId === null
        ? null
        : await this.storageService.findOwned(job.sourceFileId, userId);

    // Propagates the source parcel's own addressing (IMPROVEMENTS_TECH.md
    // 2.3) onto the result, when it had any — lets sync's pull-issue and
    // reports' Subscription find a Worker-job result the same way they'd
    // find agent-runner's own, instead of a Worker job only ever being
    // retrievable through the Worker page. Purely additive: a job run
    // against a plain (non-issue) source still produces an unaddressed
    // result, exactly as before.
    const stored = await this.storageService.create(
      userId,
      file,
      sourceFile?.taskKey
        ? {
            channel: sourceFile.channel ?? undefined,
            taskKey: sourceFile.taskKey,
            direction: StoredFileDirection.Result,
          }
        : {},
    );

    job.resultFileId = stored.id;
    job.status = JobStatus.Succeeded;
    job.finishedAt = new Date();

    // A pipeline parcel (addressed by taskKey) is single-use: once its job
    // has succeeded it has been taken and acted on, so it must not linger in
    // the mailbox. A plain file the user uploaded by hand has no taskKey and
    // is left alone — they may well run it again. Saved first and deleted
    // best-effort after: a failed delete costs some clutter, never a result.
    const consumed = sourceFile?.taskKey ? sourceFile : null;

    if (consumed) {
      job.sourceFileId = null;
    }

    const saved = await this.jobRepository.save(job);

    if (consumed) {
      try {
        await this.storageService.delete(consumed);
      } catch (error) {
        this.logger.warn(
          `Failed to delete consumed source parcel ${consumed.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return saved;
  }
}
