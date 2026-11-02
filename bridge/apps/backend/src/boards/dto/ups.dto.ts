import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { HOST_PATTERN } from './boards.dto';

// What infra/ups/report.sh posts. Readings the UPS did not give are left out or null.
export class UpsReportDto {
  @IsString()
  @Matches(HOST_PATTERN)
  host: string;

  @IsString()
  @Matches(/^[A-Z ]{1,40}$/)
  status: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  chargePct?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  runtimeSec?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(300)
  loadPct?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  inputVolts?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  batteryVolts?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  nominalWatts?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  testResult?: string | null;
}
