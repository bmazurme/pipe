import { IsBoolean } from 'class-validator';

export class ResolveQuestionDto {
  @IsBoolean()
  resolved: boolean;
}
