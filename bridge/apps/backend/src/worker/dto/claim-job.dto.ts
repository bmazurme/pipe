import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ClaimJobDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  workerName?: string;
}
