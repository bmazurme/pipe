import { IsIn, IsOptional, IsString, Length } from 'class-validator';

import { API_KEY_SCOPES, type ApiKeyScope } from '../api-key-scope';

export class CreateApiKeyDto {
  @IsString()
  @Length(1, 255)
  name: string;

  // Omitted = a full key; boards = the boards' agent only; readonly = GET only; reports-sync = what reports' server calls.
  @IsOptional()
  @IsIn(API_KEY_SCOPES)
  scope?: ApiKeyScope;

  // Omitted = 90 days. null = never expires: allowed, but it has to be asked for. (IsOptional lets null through.)
  @IsOptional()
  @IsIn([30, 90, 365])
  expiresInDays?: 30 | 90 | 365 | null;
}
