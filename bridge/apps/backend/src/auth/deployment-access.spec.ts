import type { ConfigService } from '@nestjs/config';

import type { UsersService } from '../users/users.service';
import {
  DeploymentAccessService,
  parseAllowedEmails,
} from './deployment-access';

describe('parseAllowedEmails', () => {
  it('returns an empty list for unset, empty and whitespace-only values', () => {
    expect(parseAllowedEmails(undefined)).toEqual([]);
    expect(parseAllowedEmails('')).toEqual([]);
    expect(parseAllowedEmails('   ')).toEqual([]);
    expect(parseAllowedEmails(' , ')).toEqual([]);
  });

  it('trims entries and drops blank ones', () => {
    expect(parseAllowedEmails(' a@x.io ,, b@x.io ')).toEqual([
      'a@x.io',
      'b@x.io',
    ]);
  });
});

describe('DeploymentAccessService', () => {
  const build = (emails: string | undefined) => {
    const users = {
      findById: jest.fn((id: number) =>
        Promise.resolve({ id, email: id === 1 ? 'a@x.io' : 'b@x.io' }),
      ),
      findOwner: jest.fn().mockResolvedValue({ id: 1 }),
    };
    const config = { get: jest.fn().mockReturnValue(emails) };

    return new DeploymentAccessService(
      users as unknown as UsersService,
      config as unknown as ConfigService,
    );
  };

  it.each([undefined, '', '   ', ' , '])(
    'with EMAILS=%j anyone signs in and only the first account is owner',
    async (emails) => {
      const access = build(emails);

      expect(access.isAllowedToSignIn('anyone@x.io')).toBe(true);
      await expect(access.isOwner(1)).resolves.toBe(true);
      await expect(access.isOwner(2)).resolves.toBe(false);
    },
  );

  it('with a populated list only listed emails sign in and own', async () => {
    const access = build(' b@x.io , c@x.io ');

    expect(access.isAllowedToSignIn('b@x.io')).toBe(true);
    expect(access.isAllowedToSignIn('a@x.io')).toBe(false);
    await expect(access.isOwner(2)).resolves.toBe(true);
    await expect(access.isOwner(1)).resolves.toBe(false);
  });

  it('compares emails case-insensitively', async () => {
    const access = build('B@X.io');

    expect(access.isAllowedToSignIn('b@x.IO')).toBe(true);
    await expect(access.isOwner(2)).resolves.toBe(true);
  });
});
