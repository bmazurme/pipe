import { IsString } from 'class-validator';

export class AppendJobLogDto {
  @IsString()
  chunk: string;
}
