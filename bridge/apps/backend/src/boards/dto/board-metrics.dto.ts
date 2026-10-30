import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

import { HOST_PATTERN } from './boards.dto';

// What infra/boardagent posts every ~2 minutes. Every reading is optional: a probe that failed on the board is simply absent.
export class BoardMetricsDto {
  @IsString()
  @Matches(HOST_PATTERN)
  host: string;

  @IsOptional()
  @IsInt()
  @Min(-50)
  @Max(150)
  socTempC?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(15)
  throttled?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30000)
  fanRpm?: number;

  @IsOptional()
  @IsInt()
  @Min(-50)
  @Max(150)
  nvmeTempC?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  load1?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  memAvailPct?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  memTotalMb?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  diskUsedPct?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  uptimeSec?: number;
}
