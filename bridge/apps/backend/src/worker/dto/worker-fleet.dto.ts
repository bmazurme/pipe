import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import type { ClaudeLimits } from '../claude-limits';
import { JobModel } from '../entities/job.entity';
import { Worker } from '../entities/worker.entity';

// What the owner can set for a worker; every field is optional on update and applies the next time the worker polls.
class WorkerSettingsDto {
  // null = all models.
  @ApiPropertyOptional({ enum: JobModel, isArray: true, nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(JobModel, { each: true })
  models?: JobModel[] | null;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(300)
  pollIntervalSec?: number;

  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(14_400)
  jobTimeoutSec?: number;

  // HTTP proxy for reaching AI providers; empty string or null = direct.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(/^(https?:\/\/\S+)?$/, {
    message: 'proxyUrl must be an http(s) URL',
  })
  proxyUrl?: string | null;

  @IsOptional()
  @IsBoolean()
  chatEnabled?: boolean;

  // The stored Claude token this worker uses when a job picked none; null = the account's first.
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  claudeCredentialId?: number | null;
}

export class CreateWorkerDto extends WorkerSettingsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u, {
    message:
      'name may contain letters, digits, spaces, dots, dashes and underscores',
  })
  name: string;
}

export class UpdateWorkerDto extends WorkerSettingsDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u, {
    message:
      'name may contain letters, digits, spaces, dots, dashes and underscores',
  })
  name?: string;

  // false = paused.
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class EnrollWorkerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  hostname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  version?: string;
}

// pending = created, the enrollment code not used yet · offline = enrolled, not heard from lately · idle = ready for
// work · busy = running a job · paused = switched off by the owner.
export type WorkerState = 'pending' | 'offline' | 'idle' | 'busy' | 'paused';

export class WorkerResponseDto {
  // null for a legacy worker (it authenticates with a personal API key and is only known by name).
  id: number | null;
  name: string;
  kind: 'managed' | 'legacy';
  state: WorkerState;
  enabled: boolean;
  lastSeenAt: Date | null;
  activeJobs: number;
  hostname: string | null;
  version: string | null;
  // null = all models.
  @ApiProperty({ enum: JobModel, isArray: true, nullable: true })
  models: JobModel[] | null;
  pollIntervalSec: number;
  jobTimeoutSec: number;
  proxyUrl: string | null;
  chatEnabled: boolean;
  // The Claude token this worker uses by default, or null (the account's first).
  claudeCredentialId: number | null;
  keyPrefix: string | null;
  // The one-time code is still valid (shown only when it was issued, never listed).
  enrollmentPending: boolean;
  enrollmentExpiresAt: Date | null;
  createdAt: Date | null;
  // The Claude plan limits the last run on this worker reported, or null before any run did.
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  claudeLimits: ClaudeLimits | null;

  static fromWorker(
    worker: Worker,
    activeJobs: number,
    isOnline: boolean,
    now: Date,
  ): WorkerResponseDto {
    const enrolled = worker.keyHash !== null;
    const state: WorkerState = !enrolled
      ? 'pending'
      : !worker.enabled
        ? 'paused'
        : !isOnline
          ? 'offline'
          : activeJobs > 0
            ? 'busy'
            : 'idle';

    return {
      id: worker.id,
      name: worker.name,
      kind: 'managed',
      state,
      enabled: worker.enabled,
      lastSeenAt: worker.lastSeenAt,
      activeJobs,
      hostname: worker.hostname,
      version: worker.version,
      models: worker.models,
      pollIntervalSec: worker.pollIntervalSec,
      jobTimeoutSec: worker.jobTimeoutSec,
      proxyUrl: worker.proxyUrl,
      chatEnabled: worker.chatEnabled,
      claudeCredentialId: worker.claudeCredentialId ?? null,
      keyPrefix: worker.keyPrefix,
      enrollmentPending:
        !enrolled &&
        worker.enrollExpiresAt !== null &&
        worker.enrollExpiresAt.getTime() > now.getTime(),
      enrollmentExpiresAt: worker.enrollExpiresAt,
      createdAt: worker.createdAt,
      claudeLimits: worker.claudeLimits ?? null,
    };
  }

  static legacy(
    name: string,
    lastSeenAt: Date,
    activeJobs: number,
    isOnline: boolean,
  ): WorkerResponseDto {
    return {
      id: null,
      name,
      kind: 'legacy',
      state: !isOnline ? 'offline' : activeJobs > 0 ? 'busy' : 'idle',
      enabled: true,
      lastSeenAt,
      activeJobs,
      hostname: null,
      version: null,
      models: null,
      pollIntervalSec: 10,
      jobTimeoutSec: 1800,
      proxyUrl: null,
      chatEnabled: true,
      keyPrefix: null,
      enrollmentPending: false,
      enrollmentExpiresAt: null,
      createdAt: null,
      claudeLimits: null,
      claudeCredentialId: null,
    };
  }
}

// Returned once, when a worker is created or its enrollment code is renewed — the code is not stored in the clear.
export class CreatedWorkerResponseDto {
  worker: WorkerResponseDto;
  enrollCode: string;
  enrollExpiresAt: Date;
}

// Returned once, to the worker that redeems a code.
export class EnrolledWorkerResponseDto {
  workerId: number;
  name: string;
  key: string;
}

// What a worker fetches before every poll: the owner's settings for it.
export class WorkerConfigResponseDto {
  id: number;
  name: string;
  enabled: boolean;
  @ApiProperty({ enum: JobModel, isArray: true, nullable: true })
  models: JobModel[] | null;
  pollIntervalSec: number;
  jobTimeoutSec: number;
  proxyUrl: string | null;
  chatEnabled: boolean;
}

export class DeletedWorkerResponseDto {
  // Jobs this worker was running at that moment: they are marked failed.
  failedJobs: number;
}
