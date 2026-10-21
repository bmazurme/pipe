import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
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
}

export class UpdateResultDto {
  @IsBoolean()
  ok: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  message?: string;
}
