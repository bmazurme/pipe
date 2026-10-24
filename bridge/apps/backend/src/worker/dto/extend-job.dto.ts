import { IsIn, IsInt } from 'class-validator';

// How many minutes the owner can add to a running job's time limit in one go.
export const EXTEND_MINUTES = [15, 30, 60] as const;

export class ExtendJobDto {
  @IsInt()
  @IsIn(EXTEND_MINUTES)
  minutes: number;
}
