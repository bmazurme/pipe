import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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

import { HOST_PATTERN } from '../../boards/dto/boards.dto';
import { PROBE_RESULTS, ProbeResult } from '../links';

export class LinkProbeResultDto {
  // host:port of the channel, as GET …/agent/channels listed it.
  @IsString()
  @MaxLength(255)
  @Matches(/^[A-Za-z0-9.:[\]_-]{1,200}:\d{1,5}$/)
  key: string;

  @IsIn(PROBE_RESULTS)
  result: ProbeResult;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(600_000)
  tcpMs?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(600_000)
  tlsMs?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  detail?: string | null;
}

// What infra/linkprobe posts: one vantage point's latest probe of each channel it was told about.
export class LinkProbeReportDto {
  @IsString()
  @Matches(HOST_PATTERN)
  vantage: string;

  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => LinkProbeResultDto)
  results: LinkProbeResultDto[];
}

export class E2eResultDto {
  // e2e:claude, e2e:telegram, … — the keys of e2e.ts.
  @IsString()
  @Matches(/^e2e:[a-z0-9_-]{1,40}$/)
  key: string;

  @IsIn(PROBE_RESULTS)
  result: ProbeResult;

  // The whole request through the tunnel, in milliseconds.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(600_000)
  tcpMs?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  detail?: string | null;
}

// What a worker posts about requests it made through its own tunnel (worker/src/tunnelProbe.ts). The vantage point is the worker's
// own name, taken from its key, never from the body.
export class E2eReportDto {
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => E2eResultDto)
  results: E2eResultDto[];
}
