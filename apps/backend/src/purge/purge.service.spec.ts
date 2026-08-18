import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';

import { UsersService } from '../users/users.service';
import { PurgeEntry } from './entities/purge-entry.entity';
import { PurgeService } from './purge.service';

type MockRepository = Partial<Record<keyof Repository<PurgeEntry>, jest.Mock>>;

function createMockRepository(): MockRepository {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };
}

describe('PurgeService', () => {
  let service: PurgeService;
  let repository: MockRepository;
  let usersService: Partial<Record<keyof UsersService, jest.Mock>>;

  beforeEach(async () => {
    repository = createMockRepository();
    usersService = {
      getPurgeDraft: jest.fn(),
      savePurgeDraft: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurgeService,
        { provide: getRepositoryToken(PurgeEntry), useValue: repository },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = module.get(PurgeService);
  });

  describe('findAllByUser', () => {
    it('scopes the query to the given user and orders by key', async () => {
      repository.find!.mockResolvedValue([]);

      await service.findAllByUser(7);

      expect(repository.find).toHaveBeenCalledWith({
        where: { userId: 7 },
        order: { key: 'ASC' },
      });
    });
  });

  describe('create', () => {
    it('saves a new entry when the key and value are both free', async () => {
      repository.findOne!.mockResolvedValue(null);
      repository.save!.mockImplementation((entry) => Promise.resolve({ id: 1, ...entry }));

      const result = await service.create(7, { key: 'foo', value: 'bar' });

      expect(repository.save).toHaveBeenCalledWith({ userId: 7, key: 'foo', value: 'bar' });
      expect(result).toMatchObject({ key: 'foo', value: 'bar' });
    });

    it('rejects a duplicate key for the same user', async () => {
      repository.findOne!.mockImplementation(({ where }) =>
        Promise.resolve(where.key === 'foo' ? { id: 1, key: 'foo', value: 'other' } : null),
      );

      await expect(service.create(7, { key: 'foo', value: 'bar' })).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('rejects a duplicate value for the same user', async () => {
      repository.findOne!.mockImplementation(({ where }) =>
        Promise.resolve(where.value === 'bar' ? { id: 1, key: 'other', value: 'bar' } : null),
      );

      await expect(service.create(7, { key: 'foo', value: 'bar' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('update', () => {
    it('throws NotFoundException for an entry owned by another user', async () => {
      repository.findOne!.mockResolvedValue(null);

      await expect(
        service.update(1, 7, { key: 'new-key' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects renaming to a key already used by this user', async () => {
      repository.findOne!
        .mockResolvedValueOnce({ id: 1, userId: 7, key: 'old', value: 'v' })
        .mockResolvedValueOnce({ id: 2, userId: 7, key: 'taken', value: 'v2' });

      await expect(service.update(1, 7, { key: 'taken' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('updates only the fields provided', async () => {
      const entry: PurgeEntry = {
        id: 1,
        userId: 7,
        key: 'old',
        value: 'v',
      } as PurgeEntry;
      repository.findOne!.mockImplementation(({ where }) =>
        Promise.resolve(where.id === 1 ? entry : null),
      );
      repository.save!.mockImplementation((e) => Promise.resolve(e));

      const result = await service.update(1, 7, { value: 'new-value' });

      expect(result).toMatchObject({ key: 'old', value: 'new-value' });
    });
  });

  describe('delete', () => {
    it('throws NotFoundException for an entry owned by another user', async () => {
      repository.findOne!.mockResolvedValue(null);
      await expect(service.delete(1, 7)).rejects.toThrow(NotFoundException);
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it('deletes an entry the user owns', async () => {
      repository.findOne!.mockResolvedValue({ id: 1, userId: 7 });
      await service.delete(1, 7);
      expect(repository.delete).toHaveBeenCalledWith(1);
    });
  });

  describe('draft text', () => {
    it('getDraft falls back to an empty string', async () => {
      usersService.getPurgeDraft!.mockResolvedValue(null);
      await expect(service.getDraft(7)).resolves.toBe('');
    });

    it('getDraft returns the stored draft', async () => {
      usersService.getPurgeDraft!.mockResolvedValue('hello world');
      await expect(service.getDraft(7)).resolves.toBe('hello world');
    });

    it('saveDraft delegates to UsersService and echoes the text back', async () => {
      usersService.savePurgeDraft!.mockResolvedValue(undefined);
      await expect(service.saveDraft(7, 'draft text')).resolves.toBe('draft text');
      expect(usersService.savePurgeDraft).toHaveBeenCalledWith(7, 'draft text');
    });
  });
});
