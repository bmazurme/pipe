import { IsString, Length } from 'class-validator';

export class CreateApiKeyDto {
  @IsString()
  @Length(1, 255)
  name: string;
}
