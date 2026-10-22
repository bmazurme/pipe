import { IsInt, Min } from 'class-validator';

export class AttachRunResultDto {
  @IsInt()
  @Min(1)
  jobId: number;
}
