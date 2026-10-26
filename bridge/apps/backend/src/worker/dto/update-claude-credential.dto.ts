import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateClaudeCredentialDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}
