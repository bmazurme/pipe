import { Type } from 'class-transformer';
import {
  IsBoolean,
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
}

export class SaveSettingsDto {
  // null switches auto-start off.
  @IsOptional()
  @Type(() => String)
  @IsString()
  autoStartModel?: string | null;
}
