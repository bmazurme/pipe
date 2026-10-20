import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

// The same four lists GET export/day-offs hands out, in the opposite direction: an external caller (reports) sends the
// year's dates and they are merged into the owner's days off.
const DATE_LIST = { each: true } as const;
const DATE_RULE = { strict: true, strictSeparator: true } as const;
const DATE_MESSAGE = {
  message: 'every date must be a real calendar date in YYYY-MM-DD format',
  each: true,
};

export class ImportDayOffsDto {
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(400)
  @IsISO8601(DATE_RULE, { ...DATE_LIST, ...DATE_MESSAGE })
  holidays?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(400)
  @IsISO8601(DATE_RULE, { ...DATE_LIST, ...DATE_MESSAGE })
  shortDays?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(400)
  @IsISO8601(DATE_RULE, { ...DATE_LIST, ...DATE_MESSAGE })
  offDays?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(400)
  @IsISO8601(DATE_RULE, { ...DATE_LIST, ...DATE_MESSAGE })
  badDays?: string[];
}

export class ImportDayOffsResponseDto {
  year: number;
  // Dates that were not there yet, dates whose kind changed, and dates already as sent.
  created: number;
  updated: number;
  unchanged: number;
}
