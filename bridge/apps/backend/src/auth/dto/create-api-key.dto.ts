import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export class CreateApiKeyDto {
  @IsString()
  @Length(1, 255)
  name: string;

  // Omitted = a full key; 'boards' = usable only by the boards' agent.
  @IsOptional()
  @IsIn(['boards'])
  scope?: 'boards';
}
