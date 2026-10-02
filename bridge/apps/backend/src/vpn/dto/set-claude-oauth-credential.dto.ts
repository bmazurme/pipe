import { IsNotEmpty, IsString } from 'class-validator';

export class SetClaudeOauthCredentialDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
