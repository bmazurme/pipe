import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreatePurgeEntryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  key: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  value: string;
}
