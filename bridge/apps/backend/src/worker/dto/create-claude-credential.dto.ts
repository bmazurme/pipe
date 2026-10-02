import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateClaudeCredentialDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsString()
  @IsNotEmpty()
  token: string;
}
