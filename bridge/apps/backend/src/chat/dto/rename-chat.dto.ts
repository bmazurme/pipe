import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RenameChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;
}
