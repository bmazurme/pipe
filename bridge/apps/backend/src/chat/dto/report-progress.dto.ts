import { IsString, MaxLength } from 'class-validator';

import { MAX_PROGRESS_LENGTH } from '../chat.limits';

// The partial reply a worker reports while a turn runs — the latest whole text, not a delta, so a lost report costs nothing.
export class ReportProgressDto {
  @IsString()
  @MaxLength(MAX_PROGRESS_LENGTH)
  text: string;
}
