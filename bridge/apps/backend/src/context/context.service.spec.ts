import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';

import { ContextService } from './context.service';
import { Context } from './entities/context.entity';

type MockRepository = Partial<Record<keyof Repository<Context>, jest.Mock>>;

describe('ContextService', () => {
  let service: ContextService;
  let repository: MockRepository;

  beforeEach(async () => {
    repository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((entity) => entity),
      save: jest.fn((entity) => Promise.resolve(entity)),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContextService,
        { provide: getRepositoryToken(Context), useValue: repository },
      ],
    }).compile();

    service = module.get(ContextService);
  });

  it('lists only the owner’s contexts, by name', async () => {
    repository.find!.mockResolvedValue([]);

    await service.findAllByUser(7);

    expect(repository.find).toHaveBeenCalledWith({
      where: { userId: 7 },
      order: { name: 'ASC' },
    });
  });

  it('will not hand out someone else’s context', async () => {
    repository.findOne!.mockResolvedValue(null);

    await expect(service.findOwned(5, 7)).rejects.toThrow(NotFoundException);
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { id: 5, userId: 7 },
    });
  });

  it('creates a context with a trimmed name', async () => {
    repository.findOne!.mockResolvedValue(null);

    const created = await service.create(7, {
      name: '  Project notes ',
      content: 'Use pnpm.',
    });

    expect(created).toMatchObject({
      userId: 7,
      name: 'Project notes',
      content: 'Use pnpm.',
    });
  });

  it('rejects a duplicate name for the same user', async () => {
    repository.findOne!.mockResolvedValue({ id: 1 });

    await expect(
      service.create(7, { name: 'Project notes', content: 'x' }),
    ).rejects.toThrow(BadRequestException);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('updates the content without a name clash check when the name is unchanged', async () => {
    const stored = { id: 1, userId: 7, name: 'Notes', content: 'old' };
    repository.findOne!.mockResolvedValue(stored);

    const updated = await service.update(1, 7, {
      name: 'Notes',
      content: 'new',
    });

    expect(updated.content).toBe('new');
    expect(repository.findOne).toHaveBeenCalledTimes(1);
  });

  it('refuses a rename onto a name already in use', async () => {
    repository
      .findOne!.mockResolvedValueOnce({
        id: 1,
        userId: 7,
        name: 'Notes',
        content: 'x',
      })
      .mockResolvedValueOnce({ id: 2 });

    await expect(service.update(1, 7, { name: 'Other' })).rejects.toThrow(
      BadRequestException,
    );
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('deletes an owned context and 404s on someone else’s', async () => {
    repository.findOne!.mockResolvedValueOnce({ id: 1, userId: 7 });
    await service.delete(1, 7);
    expect(repository.delete).toHaveBeenCalledWith(1);

    repository.findOne!.mockResolvedValueOnce(null);
    await expect(service.delete(2, 7)).rejects.toThrow(NotFoundException);
  });
});
