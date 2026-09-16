import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class ImportReportEntryDto {
  @IsString()
  @IsNotEmpty()
  taskName: string;

  @IsString()
  @IsNotEmpty()
  status: string;

  @IsNumber()
  @Min(0)
  hours: number;
}

export class ImportReportEntriesDto {
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ImportReportEntryDto)
  entries: ImportReportEntryDto[];
}
