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
