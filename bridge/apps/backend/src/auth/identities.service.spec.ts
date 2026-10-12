import { ConflictException, NotFoundException } from '@nestjs/common';

import { AuthIdentity } from './entities/auth-identity.entity';
import { IdentitiesService } from './identities.service';

function identity(
  provider: 'yandex' | 'github',
  enabled: boolean,
  id = provider === 'yandex' ? 1 : 2,
): AuthIdentity {
  return { id, userId: 7, provider, enabled } as AuthIdentity;
}

function setup(rows: AuthIdentity[]) {
  const manager = {
    find: jest.fn().mockResolvedValue(rows),
    update: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const dataSource = {
    transaction: jest.fn((fn: (m: typeof manager) => Promise<void>) =>
      fn(manager),
    ),
  };
  const repository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn((row: unknown) => Promise.resolve(row)),
    create: jest.fn((row: unknown) => row),
    update: jest.fn(),
  };
  const service = new IdentitiesService(
    repository as never,
    dataSource as never,
  );

  return { service, manager, repository };
}

describe('IdentitiesService', () => {
  describe('setEnabled', () => {
    it('refuses to disable the only enabled method', async () => {
      const { service, manager } = setup([identity('yandex', true)]);

      await expect(
        service.setEnabled(7, 'yandex', false),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('refuses when the other method is connected but already disabled', async () => {
      const { service } = setup([
        identity('yandex', true),
        identity('github', false),
      ]);

      await expect(
        service.setEnabled(7, 'yandex', false),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('disables one of two enabled methods', async () => {
      const { service, manager } = setup([
        identity('yandex', true),
        identity('github', true),
      ]);

      await service.setEnabled(7, 'github', false);

      expect(manager.update).toHaveBeenCalledWith(AuthIdentity, 2, {
        enabled: false,
      });
    });

    it('locks the user rows so two simultaneous disables cannot both pass', async () => {
      const { service, manager } = setup([
        identity('yandex', true),
        identity('github', true),
      ]);

      await service.setEnabled(7, 'github', false);

      expect(manager.find).toHaveBeenCalledWith(
        AuthIdentity,
        expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
      );
    });

    it('enables a disabled method without the last-method check', async () => {
      const { service, manager } = setup([
        identity('yandex', true),
        identity('github', false),
      ]);

      await service.setEnabled(7, 'github', true);

      expect(manager.update).toHaveBeenCalledWith(AuthIdentity, 2, {
        enabled: true,
      });
    });

    it('404s for a method that is not connected', async () => {
      const { service } = setup([identity('yandex', true)]);

      await expect(
        service.setEnabled(7, 'github', true),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('unlink', () => {
    it('refuses to unlink the only enabled method', async () => {
      const { service, manager } = setup([
        identity('yandex', true),
        identity('github', false),
      ]);

      await expect(service.unlink(7, 'yandex')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(manager.delete).not.toHaveBeenCalled();
    });

    it('unlinks a disabled method even when it is not the only one left', async () => {
      const { service, manager } = setup([
        identity('yandex', true),
        identity('github', false),
      ]);

      await service.unlink(7, 'github');

      expect(manager.delete).toHaveBeenCalledWith(AuthIdentity, 2);
    });

    it('unlinks an enabled method when another stays enabled', async () => {
      const { service, manager } = setup([
        identity('yandex', true),
        identity('github', true),
      ]);

      await service.unlink(7, 'yandex');

      expect(manager.delete).toHaveBeenCalledWith(AuthIdentity, 1);
    });
  });

  describe('link', () => {
    it('refuses an account already linked to somebody else', async () => {
      const { service, repository } = setup([]);
      repository.findOne.mockResolvedValueOnce({ userId: 99 });

      await expect(
        service.link(7, 'github', 'gh-1', 'a@b.c'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('refuses a second account of the same provider', async () => {
      const { service, repository } = setup([]);
      repository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ userId: 7 });

      await expect(
        service.link(7, 'github', 'gh-2', 'a@b.c'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('is idempotent for the same account', async () => {
      const { service, repository } = setup([]);
      const existing = { userId: 7, providerUserId: 'gh-1' };
      repository.findOne.mockResolvedValueOnce(existing);

      await expect(service.link(7, 'github', 'gh-1', 'a@b.c')).resolves.toBe(
        existing,
      );
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('creates an enabled identity for a new account', async () => {
      const { service, repository } = setup([]);
      repository.findOne.mockResolvedValue(null);

      await service.link(7, 'github', 'gh-1', 'a@b.c');

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 7,
          provider: 'github',
          providerUserId: 'gh-1',
          enabled: true,
        }),
      );
    });
  });
});
