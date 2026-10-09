import { IsEnum, IsISO8601, IsOptional, Matches } from 'class-validator';

import { DayOffType } from '../entities/day-off.entity';

export class CreateDayOffDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date must be in YYYY-MM-DD format',
  })
  // The format alone let 2025-02-31 through to Postgres, which refused it as a 500.
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: 'date must be a real calendar date' },
  )
  date: string;

  @IsEnum(DayOffType)
  @IsOptional()
  type?: DayOffType;
}
