import { IsEnum, IsInt } from 'class-validator';

import { JobModel } from '../entities/job.entity';

export class CreateJobDto {
  @IsInt()
  sourceFileId: number;

  @IsEnum(JobModel)
  model: JobModel;
}
