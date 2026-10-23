import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseIntPipe,
  Query,
  Post,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { unlink } from 'fs/promises';

import { FileInterceptor } from '@nestjs/platform-express';
import { ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { WorkerKeyAllowed } from '../auth/decorators/worker-key-allowed.decorator';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { multerConfig } from '../storage/config/multer.config';
import { MulterExceptionFilter } from '../storage/filters/multer-exception.filter';
import { respondDownloadError } from '../storage/file-store/send-stored-file';
import { AppendJobLogDto } from './dto/append-job-log.dto';
import { ClaimedJobResponseDto } from './dto/claimed-job-response.dto';
import { CancelJobDto } from './dto/cancel-job.dto';
import { ClaimJobDto } from './dto/claim-job.dto';
import { CreateJobDto } from './dto/create-job.dto';
import { HeartbeatDto } from './dto/heartbeat.dto';
import { JobResponseDto } from './dto/job-response.dto';
import { ClaudeUsageService } from './claude-usage.service';
import { LimitAlertsService } from './limit-alerts.service';
import { ReportQuestionsDto } from '../questions/dto/report-questions.dto';
import { QuestionsService } from '../questions/questions.service';
import { ReportUsageDto } from './dto/report-usage.dto';
import { RetryJobDto } from './dto/retry-job.dto';
import { UpdateJobStatusDto } from './dto/update-job-status.dto';
import type { FailureSummary } from './failure-summary';
import { RunCredentialsService } from './run-credentials.service';
import { WorkerService } from './worker.service';
import { WorkersService } from './workers.service';

// Postgres' integer range, minus the +1 SUBSTRING needs — no log gets near it.
const MAX_LOGS_FROM = 2_147_483_646;

function parseLogsFrom(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;

  const value = /^\d+$/.test(raw) ? Number(raw) : NaN;

  if (!Number.isSafeInteger(value) || value > MAX_LOGS_FROM) {
    throw new BadRequestException('logsFrom must be a non-negative integer');
  }

  return value;
}

function parseUpdatedAfter(raw: string | undefined): Date | undefined {
  if (raw === undefined) return undefined;

  const value = new Date(raw);

  if (Number.isNaN(value.getTime())) {
    throw new BadRequestException('updatedAfter must be a valid date');
  }

  return value;
}

// One controller, one guard, for both audiences — JwtOrApiKeyGuard already
// accepts a browser session OR a personal API key (the same "unified
// machine auth" sync/reports already use), exactly like storage's own
// controller. The browser calls the plain CRUD + result-download routes;
// the worker process calls claim/parcel/status/logs/result using a
// personal API key instead of a JWT.
@Controller('api/v1/worker/jobs')
@UseGuards(JwtOrApiKeyGuard)
export class WorkerController {
  private readonly logger = new Logger(WorkerController.name);

  constructor(
    private readonly workerService: WorkerService,
    private readonly runCredentials: RunCredentialsService,
    private readonly workersService: WorkersService,
    private readonly limitAlerts: LimitAlertsService,
    private readonly claudeUsage: ClaudeUsageService,
    private readonly questionsService: QuestionsService,
  ) {}

  @Get()
  @ApiQuery({ name: 'updatedAfter', required: false })
  async list(
    @CurrentUser() currentUser: { id: number },
    @Query('updatedAfter') updatedAfterRaw?: string,
  ): Promise<JobResponseDto[]> {
    const jobs = await this.workerService.findAllByUser(
      currentUser.id,
      parseUpdatedAfter(updatedAfterRaw),
    );

    return jobs.map(JobResponseDto.fromEntity);
  }

  @Post()
  async create(
    @Body() dto: CreateJobDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<JobResponseDto> {
    const job = await this.workerService.create(currentUser.id, dto);

    return JobResponseDto.fromEntity(job);
  }

  // POST, not GET — claiming mutates state (queued -> claimed), and needs a
  // body (the worker's self-reported name). Being POST also means it can't
  // collide with the GET ':id' route below regardless of registration order.
  @Post('claim')
  @WorkerKeyAllowed()
  async claim(
    @Body() dto: ClaimJobDto,
    @CurrentUser() currentUser: { id: number; workerId?: number },
    @Res() res: Response,
  ): Promise<void> {
    const job = await this.workerService.claim(
      currentUser.id,
      dto.workerName,
      currentUser.workerId,
    );

    // A bare `return null` from a Nest handler sends a genuinely empty body
    // (no content-type, nothing for .json() to parse) rather than the JSON
    // text "null" — breaks a client that always calls response.json(). 204
    // is also the more correct status for "nothing to claim" than 201.
    if (!job) {
      res.status(HttpStatus.NO_CONTENT).end();
      return;
    }

    // Resolved here, not inside WorkerService.claim, so the plain JobResponseDto
    // used by every human-facing route never has to go anywhere near a real
    // token value — only this one machine-facing response does. A
    // credential removed after the job picked it just degrades to null
    // (worker falls back to its own inherited env var) rather than failing
    // the claim.
    const { claudeToken, claudeCredentialId, provider } =
      await this.runCredentials.resolve(
        currentUser.id,
        currentUser.workerId,
        job.model,
        {
          claudeCredentialId: job.claudeCredentialId,
          providerCredentialId: job.providerCredentialId,
        },
      );

    // Remember which stored token the run actually uses (also when it fell
    // back to the worker's or the account's first), so its limits and an auth
    // failure can be traced to it.
    if (claudeCredentialId !== null) {
      await this.claudeUsage.recordUsedCredential(
        job.id,
        currentUser.id,
        claudeCredentialId,
      );
    }

    res
      .status(HttpStatus.OK)
      .json(
        ClaimedJobResponseDto.fromEntityWithToken(job, claudeToken, provider),
      );
  }

  // Sent on an interval by a worker that's busy with a job (and so isn't
  // polling claim) to keep showing as up. Name is required here, unlike claim.
  @Post('heartbeat')
  @WorkerKeyAllowed()
  @HttpCode(HttpStatus.NO_CONTENT)
  async heartbeat(
    @Body() dto: HeartbeatDto,
    @CurrentUser() currentUser: { id: number; workerId?: number },
  ): Promise<void> {
    // A worker added in the UI is known by its key, whatever name it passes.
    if (currentUser.workerId !== undefined) {
      await this.workersService.touch(currentUser.workerId);
      return;
    }

    await this.workerService.recordHeartbeat(currentUser.id, dto.workerName);
  }

  // After a Claude run: plan limits and the job's tokens and cost (see ClaudeUsageService.recordReport).
  @Post('usage')
  @WorkerKeyAllowed()
  @HttpCode(HttpStatus.NO_CONTENT)
  async reportUsage(
    @Body() dto: ReportUsageDto,
    @CurrentUser() currentUser: { id: number; workerId?: number },
  ): Promise<void> {
    const recorded = await this.claudeUsage.recordReport(
      currentUser.id,
      currentUser.workerId,
      dto,
    );

    // Tell the owner when a plan window is running out. Awaited only to keep it in order with the response; it never throws.
    if (recorded) {
      await this.limitAlerts.check({
        userId: currentUser.id,
        workerId: currentUser.workerId,
        credentialId: recorded.credentialId,
        limits: recorded.limits,
      });
    }
  }

  // How many earlier runs of a parcel's task could be mixed in at launch. Declared before
  // ':id' so "history" is never read as a job id.
  @Get('history')
  async history(
    @Query('sourceFileId', ParseIntPipe) sourceFileId: number,
    @CurrentUser() currentUser: { id: number },
  ): Promise<{ count: number }> {
    return this.workerService.previewHistory(currentUser.id, sourceFileId);
  }

  // Why jobs failed lately, grouped by normalized error. Declared before ':id' so
  // "failure-summary" is never read as a job id.
  @Get('failure-summary')
  @ApiQuery({ name: 'days', required: false, type: Number })
  async failureSummary(
    @CurrentUser() currentUser: { id: number },
    // A string on purpose, like `logsFrom` below: a missing number must not become NaN.
    @Query('days') daysRaw?: string,
  ): Promise<FailureSummary> {
    const parsed = Number(daysRaw);
    const days =
      Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 90) : 7;

    return this.workerService.failureSummary(currentUser.id, days);
  }

  // `logsFrom` is for the job dialog's poll: with it, `logs` carries only the
  // characters after the first `logsFrom` ones, plus `logsLength`, instead of
  // re-sending the whole log every few seconds. Without it, nothing changes.
  @Get(':id')
  @ApiQuery({ name: 'logsFrom', required: false, type: Number })
  async get(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number },
    // A string on purpose: the app-wide ValidationPipe (transform: true) turns a missing number into NaN before a
    // ParseIntPipe could treat it as absent, which made a plain GET :id answer 400.
    @Query('logsFrom') logsFromRaw?: string,
  ): Promise<JobResponseDto> {
    const logsFrom = parseLogsFrom(logsFromRaw);

    if (logsFrom === undefined) {
      const job = await this.workerService.findOwned(id, currentUser.id);

      return JobResponseDto.fromEntity(job);
    }

    const { job, logsTail, logsLength } =
      await this.workerService.findOwnedWithLogsFrom(
        id,
        currentUser.id,
        logsFrom,
      );

    return { ...JobResponseDto.fromEntity(job), logs: logsTail, logsLength };
  }

  @Get(':id/cancel-state')
  @WorkerKeyAllowed()
  async cancelState(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number; workerId?: number },
  ): Promise<{
    id: number;
    status: string;
    cancelRequestedAt: Date | null;
  }> {
    await this.workerService.assertHeldBy(
      id,
      currentUser.id,
      currentUser.workerId,
    );
    const {
      id: jobId,
      status,
      cancelRequestedAt,
    } = await this.workerService.getCancelState(id, currentUser.id);

    return { id: jobId, status, cancelRequestedAt };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number },
  ): Promise<void> {
    await this.workerService.remove(id, currentUser.id);
  }

  @Get(':id/parcel')
  @WorkerKeyAllowed()
  async downloadParcel(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number; workerId?: number },
    @Res() res: Response,
  ): Promise<void> {
    await this.workerService.assertHeldBy(
      id,
      currentUser.id,
      currentUser.workerId,
    );
    const file = await this.workerService.getSourceFile(id, currentUser.id);

    this.workerService.download(res, file, (err) => {
      if (err) respondDownloadError(res, file, err, this.logger);
    });
  }

  @Get(':id/result/download')
  async downloadResult(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number },
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.workerService.getResultFile(id, currentUser.id);

    this.workerService.download(res, file, (err) => {
      if (err) respondDownloadError(res, file, err, this.logger);
    });
  }

  // Stops a job — see WorkerService.cancel. POST (it mutates), and a sibling of
  // :id/status rather than a status value of its own: the owner asks, the worker
  // is the one that reports 'cancelled'.
  @Post(':id/cancel')
  async cancel(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelJobDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<JobResponseDto> {
    const job = await this.workerService.cancel(
      id,
      currentUser.id,
      dto.force === true,
    );

    return JobResponseDto.fromEntity(job);
  }

  // Runs a failed or stopped job again as a new job (see WorkerService.retry).
  @Post(':id/retry')
  async retry(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number },
    @Body() dto: RetryJobDto,
  ): Promise<JobResponseDto> {
    const job = await this.workerService.retry(
      id,
      currentUser.id,
      dto.notBefore,
      {
        model: dto.model,
        claudeCredentialId: dto.claudeCredentialId,
        providerCredentialId: dto.providerCredentialId,
        contextId: dto.contextId,
        withoutContext: dto.withoutContext,
      },
    );

    return JobResponseDto.fromEntity(job);
  }

  @Post(':id/status')
  @WorkerKeyAllowed()
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateJobStatusDto,
    @CurrentUser() currentUser: { id: number; workerId?: number },
  ): Promise<JobResponseDto> {
    await this.workerService.assertHeldBy(
      id,
      currentUser.id,
      currentUser.workerId,
    );
    const job = await this.workerService.updateStatus(id, currentUser.id, dto);

    return JobResponseDto.fromEntity(job);
  }

  // The open questions a worker found in a run's output; they become a card on the Questions page.
  @Post(':id/questions')
  @WorkerKeyAllowed()
  @HttpCode(HttpStatus.NO_CONTENT)
  async reportQuestions(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReportQuestionsDto,
    @CurrentUser() currentUser: { id: number; workerId?: number },
  ): Promise<void> {
    const job = await this.workerService.findHeld(
      id,
      currentUser.id,
      currentUser.workerId,
    );

    await this.questionsService.addFromRun(
      { id: job.id, taskKey: job.taskKey },
      currentUser.id,
      dto.questions,
    );
  }

  @Post(':id/logs')
  @WorkerKeyAllowed()
  @HttpCode(HttpStatus.NO_CONTENT)
  async appendLog(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AppendJobLogDto,
    @CurrentUser() currentUser: { id: number; workerId?: number },
  ): Promise<void> {
    await this.workerService.assertHeldBy(
      id,
      currentUser.id,
      currentUser.workerId,
    );
    await this.workerService.appendLog(id, currentUser.id, dto.chunk);
  }

  @Post(':id/result')
  @WorkerKeyAllowed()
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(FileInterceptor('file', multerConfig))
  async uploadResult(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() currentUser: { id: number; workerId?: number },
  ): Promise<JobResponseDto> {
    try {
      await this.workerService.assertHeldBy(
        id,
        currentUser.id,
        currentUser.workerId,
      );
    } catch (error) {
      // multer has already staged the upload on disk; a refused one must not leave it there
      if (file?.path) await unlink(file.path).catch(() => undefined);
      throw error;
    }

    if (!file) {
      throw new BadRequestException('File is required');
    }

    const job = await this.workerService.setResult(id, currentUser.id, file);

    return JobResponseDto.fromEntity(job);
  }
}
