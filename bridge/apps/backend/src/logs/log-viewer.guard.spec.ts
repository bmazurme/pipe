import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { UsersService } from '../users/users.service';
import { LogViewerGuard } from './log-viewer.guard';

describe('LogViewerGuard', () => {
  const context = (id: number) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user: { id } }) }),
    }) as unknown as ExecutionContext;

  const build = (emails: string | undefined) => {
    const users = {
      findById: jest.fn((id: number) =>
        Promise.resolve({ id, email: id === 1 ? 'a@x.io' : 'b@x.io' }),
      ),
      findOwner: jest.fn().mockResolvedValue({ id: 1 }),
    };
    const config = { get: jest.fn().mockReturnValue(emails) };

    return new LogViewerGuard(
      users as unknown as UsersService,
      config as unknown as ConfigService,
    );
  };

  it('allows an email on the EMAILS list', async () => {
    await expect(build('b@x.io, c@x.io').canActivate(context(2))).resolves.toBe(
      true,
    );
  });

  it('rejects an email not on the EMAILS list', async () => {
    await expect(build('b@x.io').canActivate(context(1))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows the owner when EMAILS is unset', async () => {
    await expect(build(undefined).canActivate(context(1))).resolves.toBe(true);
  });

  it('rejects a non-owner when EMAILS is unset', async () => {
    await expect(build(undefined).canActivate(context(2))).rejects.toThrow(
      ForbiddenException,
    );
  });
});
