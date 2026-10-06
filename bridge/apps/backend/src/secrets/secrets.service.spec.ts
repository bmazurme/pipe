import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';

import { Secret } from './entities/secret.entity';
import { SecretsService } from './secrets.service';

type MockRepository = Partial<Record<keyof Repository<Secret>, jest.Mock>>;

function createMockRepository(): MockRepository {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((entity) => entity),
    save: jest.fn(),
    delete: jest.fn(),
  };
}

describe('SecretsService', () => {
  let service: SecretsService;
  let repository: MockRepository;

  beforeEach(async () => {
    repository = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecretsService,
        { provide: getRepositoryToken(Secret), useValue: repository },
      ],
    }).compile();

    service = module.get(SecretsService);
  });

  describe('findAllByUser', () => {
    it('scopes the query to the given user and orders by name', async () => {
      repository.find!.mockResolvedValue([]);

      await service.findAllByUser(7);

      expect(repository.find).toHaveBeenCalledWith({
        where: { userId: 7 },
        order: { name: 'ASC' },
      });
    });
  });

  describe('create', () => {
    it('saves a new secret when the name is free, defaulting description to null', async () => {
      repository.findOne!.mockResolvedValue(null);
      repository.save!.mockImplementation((entry) =>
        Promise.resolve({ id: 1, ...entry }),
      );

      const result = await service.create(7, { name: 'foo', value: 'bar' });

      expect(repository.save).toHaveBeenCalledWith({
        userId: 7,
        name: 'foo',
        value: 'bar',
        description: null,
      });
      expect(result).toMatchObject({ name: 'foo', value: 'bar' });
    });

    it('rejects a duplicate name for the same user', async () => {
      repository.findOne!.mockResolvedValue({ id: 1, name: 'foo' });

      await expect(
        service.create(7, { name: 'foo', value: 'bar' }),
      ).rejects.toThrow(BadRequestException);
      expect(repository.save).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('throws NotFoundException for a secret owned by another user', async () => {
      repository.findOne!.mockResolvedValue(null);

      await expect(service.update(1, 7, { name: 'new-name' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects renaming to a name already used by this user', async () => {
      repository
        .findOne!.mockResolvedValueOnce({
          id: 1,
          userId: 7,
          name: 'old',
          value: 'v',
        })
        .mockResolvedValueOnce({
          id: 2,
          userId: 7,
          name: 'taken',
          value: 'v2',
        });

      await expect(service.update(1, 7, { name: 'taken' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('updates only the fields provided, leaving the rest untouched', async () => {
      const secret: Secret = {
        id: 1,
        userId: 7,
        name: 'old',
        description: 'old desc',
        value: 'v',
      } as Secret;
      repository.findOne!.mockImplementation(({ where }) =>
        Promise.resolve(where.id === 1 ? secret : null),
      );
      repository.save!.mockImplementation((e) => Promise.resolve(e));

      const result = await service.update(1, 7, { value: 'new-value' });

      expect(result).toMatchObject({
        name: 'old',
        description: 'old desc',
        value: 'new-value',
      });
    });

    it('allows clearing the description by passing an empty string', async () => {
      const secret: Secret = {
        id: 1,
        userId: 7,
        name: 'old',
        description: 'old desc',
        value: 'v',
      } as Secret;
      repository.findOne!.mockResolvedValue(secret);
      repository.save!.mockImplementation((e) => Promise.resolve(e));

      const result = await service.update(1, 7, { description: '' });

      expect(result.description).toBe('');
    });
  });

  describe('delete', () => {
    it('throws NotFoundException for a secret owned by another user', async () => {
      repository.findOne!.mockResolvedValue(null);
      await expect(service.delete(1, 7)).rejects.toThrow(NotFoundException);
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it('deletes a secret the user owns', async () => {
      repository.findOne!.mockResolvedValue({ id: 1, userId: 7 });
      await service.delete(1, 7);
      expect(repository.delete).toHaveBeenCalledWith(1);
    });
  });

  describe('revealValue', () => {
    it('throws NotFoundException for a secret owned by another user', async () => {
      repository.findOne!.mockResolvedValue(null);
      await expect(service.revealValue(1, 7)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the stored value for the owning user', async () => {
      repository.findOne!.mockResolvedValue({
        id: 1,
        userId: 7,
        value: 'secret-value',
      });
      await expect(service.revealValue(1, 7)).resolves.toBe('secret-value');
    });
  });
});
