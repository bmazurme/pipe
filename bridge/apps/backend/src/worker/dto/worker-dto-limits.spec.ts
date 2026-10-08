import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { JobStatus } from '../entities/job.entity';
import {
  MAX_ERROR_MESSAGE_LENGTH,
  MAX_LOG_CHUNK_LENGTH,
} from '../worker.limits';
import { AppendJobLogDto } from './append-job-log.dto';
import { UpdateJobStatusDto } from './update-job-status.dto';

describe('AppendJobLogDto', () => {
  const errors = (chunk: unknown) =>
    validate(plainToInstance(AppendJobLogDto, { chunk }));

  it('accepts a normal chunk', async () => {
    expect(await errors('hello\n')).toHaveLength(0);
  });

  it('accepts a chunk exactly at the limit', async () => {
    expect(await errors('a'.repeat(MAX_LOG_CHUNK_LENGTH))).toHaveLength(0);
  });

  it('rejects a chunk one over the limit', async () => {
    expect(await errors('a'.repeat(MAX_LOG_CHUNK_LENGTH + 1))).toHaveLength(1);
  });
});

describe('UpdateJobStatusDto', () => {
  const errors = (errorMessage?: string) =>
    validate(
      plainToInstance(UpdateJobStatusDto, {
        status: JobStatus.Failed,
        errorMessage,
      }),
    );

  it('accepts a missing errorMessage', async () => {
    expect(await errors(undefined)).toHaveLength(0);
  });

  it('accepts a normal errorMessage', async () => {
    expect(await errors('boom')).toHaveLength(0);
  });

  it('accepts an errorMessage exactly at the limit', async () => {
    expect(await errors('a'.repeat(MAX_ERROR_MESSAGE_LENGTH))).toHaveLength(0);
  });

  it('rejects an errorMessage one over the limit', async () => {
    expect(await errors('a'.repeat(MAX_ERROR_MESSAGE_LENGTH + 1))).toHaveLength(
      1,
    );
  });
});
