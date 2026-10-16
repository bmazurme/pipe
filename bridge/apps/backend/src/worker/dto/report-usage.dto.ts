import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsObject, IsOptional, Min } from 'class-validator';

// Sent by a worker after a Claude run: the plan limits the CLI reported and, for a job, what the run cost.
// Both are best-effort and checked field by field on the way in (claude-limits.ts).
export class ReportUsageDto {
  // The job it ran for; absent for a chat turn.
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  jobId?: number;

  // True for a limits probe (no job): the limits then belong to the token the worker's jobs use.
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  probe?: boolean;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    required: false,
  })
  @IsOptional()
  @IsObject()
  limits?: Record<string, unknown>;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    required: false,
  })
  @IsOptional()
  @IsObject()
  usage?: Record<string, unknown>;
}
