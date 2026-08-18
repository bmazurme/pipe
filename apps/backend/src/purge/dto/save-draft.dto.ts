import { IsString, MaxLength } from 'class-validator';

export class SaveDraftDto {
  @IsString()
  @MaxLength(200_000)
  text: string;
}
