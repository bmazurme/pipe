import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { HOST_PATTERN } from './boards.dto';

const BIG = 1e15;

// What infra/backup/restore-drill.sh posts when a drill ends — a failed one too (`ok: false` and `error`): a drill that could not run is exactly
// the news the Dashboard exists for.
export class RestoreDrillReportDto {
  // Where the drill ran (a workstation or a board), not where the backup came from.
  @IsString()
  @Matches(HOST_PATTERN)
  host: string;

  @IsBoolean()
  ok: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  backupCreatedAt?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86_400)
  restoreSeconds?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  tables?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(BIG)
  rows?: number | null;

  // table name → exact row count; the service drops anything that is not a plain name and a non-negative integer.
  @IsOptional()
  @IsObject()
  counts?: Record<string, number> | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  lastMigration?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  error?: string | null;
}
