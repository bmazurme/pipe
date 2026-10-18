import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class LogsQueryDto {
  @IsOptional()
  @IsIn(['info', 'warn', 'error'])
  level?: 'info' | 'warn' | 'error';

  // Warn and error rows only; takes precedence over `level`.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  problems?: boolean;

  // Case-insensitive substring of the message; % and _ are matched literally.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(['http', 'job', 'loop', 'integration', 'system'])
  source?: 'http' | 'job' | 'loop' | 'integration' | 'system';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
