import { PartialType } from '@nestjs/mapped-types';
import {
  ArrayMaxSize,
  IsBoolean,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
} from 'class-validator';

import {
  PROMO_CHANNELS,
  PROMO_MODES,
  type PromoChannel,
  type PromoMode,
} from '../promo-limits';

export class CreatePromoPostDto {
  @IsIn(PROMO_CHANNELS)
  channel: PromoChannel;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  textRu?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  textEn?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  assetIds?: number[];

  @IsOptional()
  @IsIn(PROMO_MODES)
  mode?: PromoMode;

  // An explicit null clears the date.
  @IsOptional()
  @IsDateString()
  scheduledAt?: string | null;

  @IsOptional()
  @IsBoolean()
  announceInGroup?: boolean;

  @IsOptional()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/, {
    message: 'utmCampaign: латиница, цифры, «-» и «_», до 64 знаков',
  })
  utmCampaign?: string | null;
}

// The channel of an existing post does not change: a post for another channel is another post.
export class UpdatePromoPostDto extends PartialType(CreatePromoPostDto) {}

export class MarkPublishedDto {
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  externalUrl?: string;
}
