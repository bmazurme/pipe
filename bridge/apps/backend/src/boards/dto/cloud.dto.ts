import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
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

export class CloudMemoryDto {
  @IsInt()
  @Min(0)
  @Max(BIG)
  totalMb: number;

  @IsInt()
  @Min(0)
  @Max(BIG)
  availableMb: number;

  @IsInt()
  @Min(0)
  @Max(BIG)
  swapTotalMb: number;

  @IsInt()
  @Min(0)
  @Max(BIG)
  swapUsedMb: number;
}

export class CloudDiskDto {
  @IsInt()
  @Min(0)
  @Max(BIG)
  totalBytes: number;

  @IsInt()
  @Min(0)
  @Max(BIG)
  usedBytes: number;
}

export class CloudServiceDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsInt()
  @Min(0)
  @Max(1000)
  desired: number;

  @IsInt()
  @Min(0)
  @Max(1000)
  running: number;

  @IsOptional()
  @IsIn(['healthy', 'unhealthy', 'starting', 'none'])
  health?: 'healthy' | 'unhealthy' | 'starting' | 'none' | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  restarts24h?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(BIG)
  memMb?: number | null;

  @IsBoolean()
  critical: boolean;
}

export class CloudProbeDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsBoolean()
  ok: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  httpCode?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  ms?: number | null;

  @IsBoolean()
  critical: boolean;
}

export class CloudLeaderDto {
  @IsString()
  @Matches(/^[a-z0-9_-]{1,32}$/)
  site: string;

  @IsInt()
  @Min(0)
  @Max(BIG)
  epoch: number;
}

export class CloudReplicationDto {
  @IsBoolean()
  connected: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(BIG)
  lagSec?: number | null;
}

export class CloudBackupDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(BIG)
  ageHours?: number | null;
}

export class CloudCertDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsInt()
  @Min(-3650)
  @Max(36500)
  days: number;
}

// What infra/cloudagent/report.sh posts.
export class CloudReportDto {
  @IsString()
  @Matches(HOST_PATTERN)
  host: string;

  @IsInt()
  @Min(0)
  @Max(BIG)
  uptimeSec: number;

  @IsInt()
  @Min(1)
  @Max(1024)
  cpus: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  load5?: number | null;

  @ValidateNested()
  @Type(() => CloudMemoryDto)
  memory: CloudMemoryDto;

  @ValidateNested()
  @Type(() => CloudDiskDto)
  disk: CloudDiskDto;

  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => CloudServiceDto)
  services: CloudServiceDto[];

  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CloudProbeDto)
  probes: CloudProbeDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => CloudLeaderDto)
  leader?: CloudLeaderDto | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => CloudReplicationDto)
  replication?: CloudReplicationDto | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CloudBackupDto)
  backups?: CloudBackupDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CloudCertDto)
  certs?: CloudCertDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(65535, { each: true })
  exposedPorts?: number[];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  version?: string | null;
}
