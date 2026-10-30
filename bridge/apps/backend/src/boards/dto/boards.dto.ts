import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const HOST_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,98}$/;
export const SHA_PATTERN = /^[0-9a-f]{40}$/;
// Paths that may appear in a report: a file in the repository's infra/, and where it is installed on the board.
export const REPO_PATH_PATTERN = /^infra\/[A-Za-z0-9_./-]+$/;
export const INSTALLED_PATH_PATTERN =
  /^(\/[A-Za-z0-9_./-]+|@BRIDGE_PI@\/[A-Za-z0-9_.-]+)$/;

export class ReportedScriptDto {
  @IsString()
  @MaxLength(300)
  @Matches(INSTALLED_PATH_PATTERN)
  installed: string;

  @IsString()
  @MaxLength(300)
  @Matches(REPO_PATH_PATTERN)
  repoPath: string;

  @IsIn(['current', 'outdated', 'missing'])
  status: 'current' | 'outdated' | 'missing';

  @IsOptional()
  @IsString()
  @MaxLength(64)
  installedHash?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  mainHash?: string | null;
}

// What a board can say about itself besides its scripts (infra/boardagent `collect_health`): the root disk and the SSH door. Every field
// is optional — a probe that failed on the board is simply absent.
export class BoardHealthDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  diskUsedPct?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  diskFreeMb?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  inodesUsedPct?: number;

  @IsOptional()
  @IsBoolean()
  sshPasswordAuth?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  sshAuthorizedKeys?: number;

  @IsOptional()
  @IsBoolean()
  sshdActive?: boolean;
}

// What a board's agent posts about itself.
export class BoardReportDto {
  @IsString()
  @Matches(HOST_PATTERN)
  host: string;

  @IsString()
  @Matches(SHA_PATTERN)
  mainSha: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  agentVersion?: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReportedScriptDto)
  scripts: ReportedScriptDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => BoardHealthDto)
  health?: BoardHealthDto;
}

export class UpdateResultDto {
  @IsBoolean()
  ok: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  message?: string;
}
