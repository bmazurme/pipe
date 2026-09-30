import { IsOptional, IsString } from 'class-validator';

export class FailTurnDto {
  @IsString()
  @IsOptional()
  errorMessage?: string;
}
