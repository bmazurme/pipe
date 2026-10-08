import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { multerConfig } from '../storage/config/multer.config';
import { MulterExceptionFilter } from '../storage/filters/multer-exception.filter';
import { ClaudeCredentialsService } from './claude-credentials.service';
import { AppendJobLogDto } from './dto/append-job-log.dto';
import { ClaimedJobResponseDto } from './dto/claimed-job-response.dto';
import { CancelJobDto } from './dto/cancel-job.dto';
import { ClaimJobDto } from './dto/claim-job.dto';
import { CreateJobDto } from './dto/create-job.dto';
import { HeartbeatDto } from './dto/heartbeat.dto';
import { JobResponseDto } from './dto/job-response.dto';
import { UpdateJobStatusDto } from './dto/update-job-status.dto';
import { WorkerService } from './worker.service';

// One controller, one guard, for both audiences — JwtOrApiKeyGuard already
// accepts a browser session OR a personal API key (the same "unified
// machine auth" sync/reports already use), exactly like storage's own
// controller. The browser calls the plain CRUD + result-download routes;
// the worker process calls claim/parcel/status/logs/result using a
// personal API key instead of a JWT.
@Controller('api/v1/worker/jobs')
@UseGuards(JwtOrApiKeyGuard)
export class WorkerController {
  constructor(
    private readonly workerService: WorkerService,
    private readonly claudeCredentialsService: ClaudeCredentialsService,
  ) {}

  @Get()
  async list(
    @CurrentUser() currentUser: { id: number },
  ): Promise<JobResponseDto[]> {
    const jobs = await this.workerService.findAllByUser(currentUser.id);

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
  async claim(
    @Body() dto: ClaimJobDto,
    @CurrentUser() currentUser: { id: number },
    @Res() res: Response,
  ): Promise<void> {
    const job = await this.workerService.claim(currentUser.id, dto.workerName);

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
    const claudeToken =
      job.claudeCredentialId !== null
        ? await this.claudeCredentialsService.resolveToken(
            job.claudeCredentialId,
            currentUser.id,
          )
        : null;

    res
      .status(HttpStatus.OK)
      .json(ClaimedJobResponseDto.fromEntityWithToken(job, claudeToken));
  }

  // Sent on an interval by a worker that's busy with a job (and so isn't
  // polling claim) to keep showing as up. Name is required here, unlike claim.
  @Post('heartbeat')
  @HttpCode(HttpStatus.NO_CONTENT)
  async heartbeat(
    @Body() dto: HeartbeatDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<void> {
    await this.workerService.recordHeartbeat(currentUser.id, dto.workerName);
  }

  @Get(':id')
  async get(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number },
  ): Promise<JobResponseDto> {
    const job = await this.workerService.findOwned(id, currentUser.id);

    return JobResponseDto.fromEntity(job);
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
  async downloadParcel(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number },
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.workerService.getSourceFile(id, currentUser.id);

    res.download(this.workerService.filePath(file), file.originalName);
  }

  @Get(':id/result/download')
  async downloadResult(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { id: number },
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.workerService.getResultFile(id, currentUser.id);

    res.download(this.workerService.filePath(file), file.originalName);
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
  ): Promise<JobResponseDto> {
    const job = await this.workerService.retry(id, currentUser.id);

    return JobResponseDto.fromEntity(job);
  }

  @Post(':id/status')
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateJobStatusDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<JobResponseDto> {
    const job = await this.workerService.updateStatus(id, currentUser.id, dto);

    return JobResponseDto.fromEntity(job);
  }

  @Post(':id/logs')
  @HttpCode(HttpStatus.NO_CONTENT)
  async appendLog(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AppendJobLogDto,
    @CurrentUser() currentUser: { id: number },
  ): Promise<void> {
    await this.workerService.appendLog(id, currentUser.id, dto.chunk);
  }

  @Post(':id/result')
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(FileInterceptor('file', multerConfig))
  async uploadResult(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() currentUser: { id: number },
  ): Promise<JobResponseDto> {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const job = await this.workerService.setResult(id, currentUser.id, file);

    return JobResponseDto.fromEntity(job);
  }
}
