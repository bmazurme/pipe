import {
  IsBoolean,
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

// What infra/router sends every minute. Readings the router did not give are left out or null.
export class RouterReportDto {
  @IsString()
  @Matches(HOST_PATTERN)
  host: string;

  @IsBoolean()
  reachable: boolean;

  @IsBoolean()
  sshOk: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1e9)
  uptimeSec?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  wanState?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  wanAux?: number | null;

  @IsOptional()
  @IsBoolean()
  internetOk?: boolean | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  wanIp?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100_000)
  pingMs?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  pingLossPct?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1e12)
  rxBps?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1e12)
  txBps?: number | null;
}

// How a requested reboot went, once the agent saw the router come back (or gave up waiting).
export class RouterRebootResultDto {
  @IsBoolean()
  ok: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  detail?: string | null;
}
