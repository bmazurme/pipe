import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class RouterRuleDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsString()
  @MaxLength(1000)
  keywords: string;

  @IsString()
  @MaxLength(32)
  model: string;

  @IsBoolean()
  enabled: boolean;
}

export class RouterSettingsDto {
  // { "1": model, "2": model, "3": model, "4": model }
  @IsObject()
  tierModels: Record<'1' | '2' | '3' | '4', string>;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RouterRuleDto)
  rules: RouterRuleDto[];
}

export class RouterPreviewDto {
  @IsString()
  @MinLength(3)
  @MaxLength(8000)
  task: string;

  @IsIn(['any', 'fusion'])
  executor: 'any' | 'fusion';
}
