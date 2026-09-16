// Needed because this spec instantiates a class-validator DTO directly,
// outside of Nest's bootstrap (main.ts), which is what normally pulls this
// polyfill in as a transitive side effect of @nestjs/core.
import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ImportReportEntriesDto } from './import-report-entries.dto';

async function validatePayload(payload: unknown) {
  const dto = plainToInstance(ImportReportEntriesDto, payload);
  return validate(dto);
}

describe('ImportReportEntriesDto', () => {
  it('accepts a well-formed payload', async () => {
    const errors = await validatePayload({
      year: 2026,
      month: 7,
      entries: [{ taskName: 'Task', status: 'Open', hours: 5 }],
    });

    expect(errors).toHaveLength(0);
  });

  it('rejects a month outside 1-12', async () => {
    const errors = await validatePayload({
      year: 2026,
      month: 13,
      entries: [{ taskName: 'Task', status: 'Open', hours: 5 }],
    });

    expect(errors.some((error) => error.property === 'month')).toBe(true);
  });

  it('rejects an empty entries array', async () => {
    const errors = await validatePayload({ year: 2026, month: 7, entries: [] });

    expect(errors.some((error) => error.property === 'entries')).toBe(true);
  });

  it('rejects a malformed entry nested inside a valid payload', async () => {
    const errors = await validatePayload({
      year: 2026,
      month: 7,
      entries: [{ taskName: '', status: 'Open', hours: 5 }],
    });

    expect(errors.some((error) => error.property === 'entries')).toBe(true);
  });

  it('rejects negative hours', async () => {
    const errors = await validatePayload({
      year: 2026,
      month: 7,
      entries: [{ taskName: 'Task', status: 'Open', hours: -1 }],
    });

    expect(errors.some((error) => error.property === 'entries')).toBe(true);
  });
});
