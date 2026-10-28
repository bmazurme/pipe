import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateSecretDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsString()
  @IsNotEmpty()
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
