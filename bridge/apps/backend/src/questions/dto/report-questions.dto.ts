import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

import {
  MAX_QUESTION_LENGTH,
  MAX_QUESTIONS_PER_REPORT,
} from '../questions.limits';

export class ReportQuestionsDto {
  @IsArray()
  @ArrayMaxSize(MAX_QUESTIONS_PER_REPORT)
  @IsString({ each: true })
  @MaxLength(MAX_QUESTION_LENGTH, { each: true })
  questions: string[];
}
