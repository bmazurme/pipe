import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { MAX_CONTEXT_LENGTH, MAX_CONTEXT_NAME_LENGTH } from '../context.limits';

export class CreateContextDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CONTEXT_NAME_LENGTH)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CONTEXT_LENGTH)
  content: string;
}
