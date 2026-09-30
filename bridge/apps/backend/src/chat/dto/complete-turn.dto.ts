import { IsNotEmpty, IsString } from 'class-validator';

export class CompleteTurnDto {
  @IsString()
  @IsNotEmpty()
  content: string;
}
