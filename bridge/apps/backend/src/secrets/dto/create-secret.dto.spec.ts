import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateSecretDto } from './create-secret.dto';
import { UpdateSecretDto } from './update-secret.dto';

describe('CreateSecretDto expiresOn', () => {
  const base = { name: 'foo', value: 'bar' };

  it('refuses a non-date string', async () => {
    const errors = await validate(
      plainToInstance(CreateSecretDto, { ...base, expiresOn: 'not-a-date' }),
    );

    expect(errors.map((e) => e.property)).toContain('expiresOn');
  });

  it('accepts a date, or no date', async () => {
    expect(
      await validate(
        plainToInstance(CreateSecretDto, { ...base, expiresOn: '2026-12-01' }),
      ),
    ).toHaveLength(0);
    expect(await validate(plainToInstance(CreateSecretDto, base))).toHaveLength(
      0,
    );
  });

  it('accepts an explicit null on update', async () => {
    expect(
      await validate(plainToInstance(UpdateSecretDto, { expiresOn: null })),
    ).toHaveLength(0);
  });
});
