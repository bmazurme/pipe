import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
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
  MinLength,
} from 'class-validator';
import { ALL_CATEGORIES } from '../analysis';

// Each issue number / index can start a paid worker run or file a GitHub issue.
export const MAX_BATCH_ISSUES = 20;
export const MAX_ITEM_INDICES = 50;

export class StartRunDto {
  @IsInt()
  @Min(1)
  issueNumber: number;

  @IsString()
  model: string;
}

export class StartPrFixDto {
  @IsInt()
  @Min(1)
  prNumber: number;

  @IsString()
  @MinLength(3)
  @MaxLength(4000)
  instruction: string;

  @IsString()
  model: string;
}

export class StartPrMergeDto {
  @IsInt()
  @Min(1)
  prNumber: number;
}

export class SaveScheduleDto {
  @IsString()
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

  @IsInt()
  @Min(1)
  @Max(20)
  count: number;

  @IsString()
  model: string;

  @IsOptional()
  @IsString()
  @Matches(/^[\w.\- ]{1,64}$/)
  label?: string;

  // 'issues' (default) runs the oldest open issues; 'analysis' runs an analysis.
  @IsOptional()
  @IsIn(['issues', 'analysis'])
  kind?: 'issues' | 'analysis';

  // Analysis only; empty/absent = all five directions.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ALL_CATEGORIES.length)
  @ArrayUnique()
  @IsString({ each: true })
  categories?: string[];

  @IsOptional()
  @IsBoolean()
  autoCreateIssues?: boolean;

  @IsOptional()
  @IsBoolean()
  autoStartIssues?: boolean;
}

export class StartAnalysisDto {
  @IsString()
  model: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ALL_CATEGORIES.length)
  @ArrayUnique()
  @IsString({ each: true })
  categories?: string[];

  // File the proposals as GitHub issues straight away.
  @IsOptional()
  @IsBoolean()
  autoCreate?: boolean;

  // File the proposals AND start a run for each (implies autoCreate).
  @IsOptional()
  @IsBoolean()
  autoStart?: boolean;
}

export class StartManyDto {
  @IsArray()
  @ArrayMaxSize(MAX_BATCH_ISSUES)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  issueNumbers: number[];

  @IsString()
  model: string;
}

export class StartItemsDto {
  @IsString()
  model: string;

  // Which proposals to take into work; absent = all.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ITEM_INDICES)
  @IsInt({ each: true })
  @Min(0, { each: true })
  indices?: number[];
}

export class CreateIssuesDto {
  // Which proposals to file (indices into the run's items); absent = all.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ITEM_INDICES)
  @IsInt({ each: true })
  @Min(0, { each: true })
  indices?: number[];
}

export class SaveSettingsDto {
  // null switches auto-start off.
  @IsOptional()
  @Type(() => String)
  @IsString()
  autoStartModel?: string | null;

  // Fix CI on the pull requests Improve opened (a worker on the PR's branch, at most twice per PR).
  @IsOptional()
  @IsBoolean()
  autoRepairCi?: boolean;
}
