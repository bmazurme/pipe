import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { JobStatus } from '../entities/job.entity';
import { UpdateJobStatusDto } from './update-job-status.dto';

async function errorsFor(status: unknown) {
  return validate(plainToInstance(UpdateJobStatusDto, { status }));
}

describe('UpdateJobStatusDto', () => {
  it.each([JobStatus.Running, JobStatus.Succeeded, JobStatus.Failed])(
    'accepts %s',
    async (status) => {
      expect(await errorsFor(status)).toHaveLength(0);
    },
  );

  it.each([JobStatus.Queued, JobStatus.Claimed, 'bogus', undefined])(
    'rejects %s',
    async (status) => {
      const errors = await errorsFor(status);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('status');
    },
  );
});
