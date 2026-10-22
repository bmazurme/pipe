import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

import { MAX_ANSWER_LENGTH } from '../questions.limits';

export class ResolveQuestionDto {
  @IsOptional()
  @IsBoolean()
  resolved?: boolean;

  // Trimmed; an empty one clears the answer. A non-empty one also resolves the question.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(MAX_ANSWER_LENGTH)
  answer?: string;
}
