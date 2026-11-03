import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateSecretDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^[A-Za-z_][A-Za-z0-9_]*$/)
  name: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[^\r\n]*$/)
  @MaxLength(64000)
  value: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  // An explicit null (on update) clears the date.
  @IsOptional()
  @IsDateString()
  expiresOn?: string | null;
}
