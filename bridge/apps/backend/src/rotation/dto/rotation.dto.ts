import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class MarkRotatedDto {
  // When it was changed (default: now). Never in the future: a reminder that starts from next month would hide a late one.
  @IsOptional()
  @IsDateString()
  at?: string;
}

// What infra/backup/key-check.sh posts — a failed check too, with the reason.
export class KeyCheckReportDto {
  // Which copy: «mac», «usb», «paper»… The owner's own word, so two reports with the same label are the same copy.
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._ -]{0,39}$/)
  label: string;

  @IsBoolean()
  ok: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  backupCreatedAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  error?: string | null;
}
