import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ListChatsQueryDto {
  // Text to look for in a chat's title or in any of its messages.
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q?: string;
}
