import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class SaveGithubConnectionDto {
  @IsBoolean()
  enabled: boolean;

  // An http(s) URL of the proxy; absent = keep the saved one (or the default).
  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;
}

export class CheckGithubConnectionDto {
  // The proxy to try; absent = the saved one (or the default).
  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;
}
