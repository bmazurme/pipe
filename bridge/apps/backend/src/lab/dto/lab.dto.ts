import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

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
  @Matches(/^[\w./-]{1,100}$/)
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
  @Matches(/^[\w./-]{1,100}$/)
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
  @Matches(/^[\w./-]{1,100}$/)
  baseBranch?: string;
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
}
