import { Type } from 'class-transformer';
import {
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
} from 'class-validator';

export class StartRunDto {
  @IsInt()
  @Min(1)
  issueNumber: number;

  @IsString()
  model: string;
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
  @ArrayUnique()
  @IsString({ each: true })
  categories?: string[];

  @IsOptional()
  @IsBoolean()
  autoCreateIssues?: boolean;
}

export class StartAnalysisDto {
  @IsString()
  model: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  categories?: string[];

  // File the proposals as GitHub issues straight away.
  @IsOptional()
  @IsBoolean()
  autoCreate?: boolean;
}

export class CreateIssuesDto {
  // Which proposals to file (indices into the run's items); absent = all.
  @IsOptional()
  @IsArray()
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
}
