import { IsEnum, IsOptional, Matches } from 'class-validator';

import { DayOffType } from '../entities/day-off.entity';

export class CreateDayOffDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date must be in YYYY-MM-DD format',
  })
  date: string;

  @IsEnum(DayOffType)
  @IsOptional()
  type?: DayOffType;
}
