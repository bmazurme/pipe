import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';

import { VpnConnection } from './entities/vpn-connection.entity';
import { VpnConnectionsService } from './vpn-connections.service';

type MockQueryBuilder = {
  update: jest.Mock;
  set: jest.Mock;
  where: jest.Mock;
  execute: jest.Mock;
};

function createMockQueryBuilder(): MockQueryBuilder {
  const qb: Partial<MockQueryBuilder> = {};
  qb.update = jest.fn(() => qb as MockQueryBuilder);
  qb.set = jest.fn(() => qb as MockQueryBuilder);
  qb.where = jest.fn(() => qb as MockQueryBuilder);
  qb.execute = jest.fn(async () => ({ affected: 1 }));
  return qb as MockQueryBuilder;
}

interface MockRepository {
  count: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  find: jest.Mock;
  findOneBy: jest.Mock;
  delete: jest.Mock;
  createQueryBuilder: jest.Mock;
  manager: { transaction: jest.Mock };
}

function createMockRepository(): MockRepository {
  const queryBuilder = createMockQueryBuilder();
  return {
    count: jest.fn(),
    create: jest.fn((partial) => partial),
    save: jest.fn(),
    find: jest.fn(),
    findOneBy: jest.fn(),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(() => queryBuilder),
    manager: {
      transaction: jest.fn(async (fn: (manager: unknown) => Promise<void>) => {
        await fn({ createQueryBuilder: () => createMockQueryBuilder() });
      }),
    },
  };
}

describe('VpnConnectionsService', () => {
  let service: VpnConnectionsService;
  let repository: ReturnType<typeof createMockRepository>;

  beforeEach(async () => {
    repository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VpnConnectionsService,
        { provide: getRepositoryToken(VpnConnection), useValue: repository },
      ],
    }).compile();

    service = module.get(VpnConnectionsService);
  });

  describe('create', () => {
    it('marks the first-ever connection active automatically', async () => {
      repository.count!.mockResolvedValue(0);
      repository.save!.mockImplementation((entity) =>
        Promise.resolve({ id: 1, ...entity }),
      );

      const connection = await service.create(
        'primary',
        'https://panel',
        'token',
        '203.0.113.5',
      );

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: true }),
      );
      expect(connection.isActive).toBe(true);
    });

    it('leaves a later connection inactive by default', async () => {
      repository.count!.mockResolvedValue(1);
      repository.save!.mockImplementation((entity) =>
        Promise.resolve({ id: 2, ...entity }),
      );

      await service.create(
        'secondary',
        'https://panel2',
        'token2',
        '203.0.113.6',
      );

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
      );
    });
  });

  describe('getActive', () => {
    it('throws when nothing is active', async () => {
      repository.findOneBy!.mockResolvedValue(null);

      // A missing active connection is a 404 now (a client can tell it from a server fault).
      await expect(service.getActive()).rejects.toThrow(NotFoundException);
    });

    it('returns the active connection', async () => {
      repository.findOneBy!.mockResolvedValue({ id: 1, isActive: true });

      await expect(service.getActive()).resolves.toMatchObject({ id: 1 });
      expect(repository.findOneBy).toHaveBeenCalledWith({ isActive: true });
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException for an unknown id', async () => {
      repository.findOneBy!.mockResolvedValue(null);

      await expect(service.findOne(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('throws NotFoundException for an unknown id', async () => {
      repository.findOneBy!.mockResolvedValue(null);

      await expect(service.update(99, { name: 'new' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('updates only the fields provided, leaving the rest untouched', async () => {
      const connection = {
        id: 1,
        name: 'old',
        panelUrl: 'https://old-panel',
        panelApiToken: 'old-token',
        serverAddress: '203.0.113.5',
        isActive: true,
      };
      repository.findOneBy!.mockResolvedValue(connection);
      repository.save!.mockImplementation((entity) => Promise.resolve(entity));

      const result = await service.update(1, { name: 'renamed' });

      expect(result).toMatchObject({
        name: 'renamed',
        panelUrl: 'https://old-panel',
        panelApiToken: 'old-token',
        serverAddress: '203.0.113.5',
      });
    });

    it('overwrites panelUrl/panelApiToken only when a new value is given', async () => {
      const connection = {
        id: 1,
        name: 'old',
        panelUrl: 'https://old-panel',
        panelApiToken: 'old-token',
        serverAddress: '203.0.113.5',
        isActive: true,
      };
      repository.findOneBy!.mockResolvedValue(connection);
      repository.save!.mockImplementation((entity) => Promise.resolve(entity));

      const result = await service.update(1, {
        panelUrl: 'https://new-panel',
        panelApiToken: 'new-token',
      });

      expect(result).toMatchObject({
        name: 'old',
        panelUrl: 'https://new-panel',
        panelApiToken: 'new-token',
      });
    });
  });

  describe('activate', () => {
    it('404s before touching anything if the id does not exist', async () => {
      repository.findOneBy!.mockResolvedValue(null);

      await expect(service.activate(99)).rejects.toThrow(NotFoundException);
      expect(repository.manager.transaction).not.toHaveBeenCalled();
    });

    it('runs the deactivate-then-activate pair inside one transaction', async () => {
      repository.findOneBy!.mockResolvedValue({ id: 2 });

      await service.activate(2);

      expect(repository.manager.transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('remove', () => {
    it('deletes by id', async () => {
      await service.remove(5);
      expect(repository.delete).toHaveBeenCalledWith(5);
    });
  });
});
