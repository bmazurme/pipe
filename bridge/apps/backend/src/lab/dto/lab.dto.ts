import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  ValidateBy,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { isValidBranch } from '../lab-github';
import { LAB_EXECUTORS, type LabExecutor } from '../lab-executor';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// A git-valid branch name: it is spliced into GitHub API paths, so `..` and the like must never get through.
const IsBranchName = () =>
  ValidateBy({
    name: 'isBranchName',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' && isValidBranch(value),
      defaultMessage: () => 'Недопустимое имя ветки',
    },
  });

export class CreateLabProjectDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  // 'owner/name'
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  repo: string;

  // A personal access token of the owner's GitHub account (fine-grained: Contents and Pull requests, read and write).
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  token: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsBranchName()
  baseBranch?: string;
}

export class UpdateLabProjectDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsBranchName()
  baseBranch?: string;

  // A new token; absent = keep the stored one.
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  token?: string;
}

export class StartLabRunDto {
  @IsInt()
  @Min(1)
  projectId: number;

  // What to do, in the owner's own words.
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(8000)
  task: string;

  @IsString()
  model: string;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  contextId?: number | null;

  // Absent = the project's base branch.
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsBranchName()
  baseBranch?: string;

  // Where to run: 'any' worker (default) or 'fusion' — only a worker set up for Fusion 360.
  @ApiPropertyOptional({ enum: LAB_EXECUTORS })
  @IsOptional()
  @IsIn(LAB_EXECUTORS)
  executor?: LabExecutor;

  // A run whose open pull request this one continues: the result is a new commit on its branch.
  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  followUpOf?: number;
}

export class SaveLabScheduleDto {
  @IsInt()
  @Min(1)
  projectId: number;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsBoolean()
  enabled: boolean;

  @IsInt()
  @Min(0)
  @Max(23)
  hour: number;

  @IsInt()
  @Min(0)
  @Max(59)
  minute: number;

  @IsString()
  @MaxLength(64)
  timezone: string;

  // ISO weekdays (1 = Mon … 7 = Sun) to fire on; absent or null = every day.
  @ApiPropertyOptional({ type: [Number], nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  weekdays?: number[] | null;

  // Skip a scheduled run while the base branch has no commits since the schedule's previous run.
  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  onlyOnNewCommits?: boolean;

  @IsString()
  model: string;

  // The task, as text: what the worker is asked to do in the repository on every run.
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(8000)
  task: string;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  contextId?: number | null;

  // Where to run: 'any' worker (default) or 'fusion' — only a worker set up for Fusion 360.
  @ApiPropertyOptional({ enum: LAB_EXECUTORS })
  @IsOptional()
  @IsIn(LAB_EXECUTORS)
  executor?: LabExecutor;
}

// GET /lab/runs?projectId=… — the project filter is optional. It is a DTO and not `@Query('projectId', new ParseIntPipe({ optional: true }))`
// on purpose: the global ValidationPipe (transform: true) turns a missing `number` parameter into NaN (an empty one into 0) BEFORE that pipe runs,
// so "all projects" was refused with 400 "numeric string is expected". Here a missing value stays missing.
export class ListLabRunsQueryDto {
  @ApiPropertyOptional({
    type: Number,
    description: 'Only the runs of this project; omitted = every project',
  })
  @IsOptional()
  // @Type has already made '' into 0 by the time a @Transform runs, so the original query value is what tells "empty" from a real number.
  @Transform(
    ({ value, obj }: { value: unknown; obj: Record<string, unknown> }) =>
      obj.projectId === '' ? undefined : value,
  )
  @Type(() => Number)
  @IsInt()
  @Min(1)
  projectId?: number;
}
