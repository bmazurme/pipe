import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { MAX_REPLY_LENGTH } from '../chat.limits';

export class CompleteTurnDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_REPLY_LENGTH)
  content: string;
}
