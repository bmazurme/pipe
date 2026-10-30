import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { HOST_PATTERN } from './boards.dto';

const BIG = 1e15;

export class NasBackupDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  createdAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  latest?: string | null;

  @IsInt()
  @Min(0)
  @Max(100000)
  snapshots: number;

  @IsInt()
  @Min(0)
  @Max(BIG)
  bytes: number;
}

export class NasRaidDto {
  @IsString()
  @MaxLength(200)
  summary: string;

  @IsBoolean()
  degraded: boolean;

  @IsBoolean()
  syncing: boolean;
}

export class NasVolumeDto {
  @IsInt()
  @Min(0)
  @Max(BIG)
  totalBytes: number;

  @IsInt()
  @Min(0)
  @Max(BIG)
  usedBytes: number;
}

export class NasDiskDto {
  @IsString()
  @Matches(/^[a-z0-9]{2,16}$/)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string | null;

  @IsBoolean()
  healthPassed: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(BIG)
  reallocated?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(BIG)
  powerOnHours?: number | null;

  @IsOptional()
  @IsInt()
  @Min(-50)
  @Max(150)
  tempC?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(BIG)
  pending?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(BIG)
  uncorrectable?: number | null;
}

// What infra/nas/report.sh posts.
export class NasReportDto {
  @IsString()
  @Matches(HOST_PATTERN)
  host: string;

  @IsInt()
  @Min(0)
  @Max(BIG)
  uptimeSec: number;

  @ValidateNested()
  @Type(() => NasBackupDto)
  backup: NasBackupDto;

  @ValidateNested()
  @Type(() => NasRaidDto)
  raid: NasRaidDto;

  @ValidateNested()
  @Type(() => NasVolumeDto)
  volume: NasVolumeDto;

  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => NasDiskDto)
  disks: NasDiskDto[];
}
