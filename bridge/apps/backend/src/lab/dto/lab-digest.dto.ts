import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import {
  CONTENT_MAX,
  PREVIEW_MAX,
  TAG_MAX_LENGTH,
  TAGS_MAX,
  TITLE_MAX,
} from '../lab-digest';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const WEEK = /^\d{4}-\d{2}-\d{2}$/;

// The week (the Monday, 'YYYY-MM-DD') a preview or a digest is about. Whether it really is a Monday is checked by the service.
export class DigestWeekQueryDto {
  @Matches(WEEK, { message: 'weekStart: ожидается YYYY-MM-DD' })
  weekStart: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includePrivate?: boolean;
}

export class StartLabDigestDto {
  @Matches(WEEK, { message: 'weekStart: ожидается YYYY-MM-DD' })
  weekStart: string;

  // Not given: what the settings say.
  @IsOptional()
  @IsBoolean()
  includePrivate?: boolean;

  // A model or 'custom:<key id>'. Not given: what the settings say.
  @IsOptional()
  @IsString()
  @MaxLength(32)
  model?: string;
}

export class SaveLabDigestSettingsDto {
  @IsOptional()
  @IsBoolean()
  autoWeekly?: boolean;

  @IsOptional()
  @IsBoolean()
  includePrivate?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  model?: string;

  // The site's address; empty = notes.ntlstl.dev.
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  notesUrl?: string;

  // The key for POST /api/v1/notes/drafts; empty removes the stored one. Never returned.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  notesKey?: string;
}

// The owner's edits of a draft. Only what is given changes.
export class UpdateLabDigestDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(TITLE_MAX)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(PREVIEW_MAX)
  preview?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(CONTENT_MAX)
  content?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TAGS_MAX)
  @Type(() => String)
  @IsString({ each: true })
  @MaxLength(TAG_MAX_LENGTH, { each: true })
  tags?: string[];
}
