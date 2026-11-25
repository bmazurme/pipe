import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';

import { TaskCard } from './entities/task-card.entity';
import { TaskColumn } from './entities/task-column.entity';
import { TasksService } from './tasks.service';

describe('TasksService', () => {
  let service: TasksService;
  let columns: Record<string, jest.Mock>;
  let cards: Record<string, jest.Mock>;

  beforeEach(async () => {
    columns = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn((e) => e),
      save: jest.fn(async (e) => ({ id: 1, ...e })),
      delete: jest.fn(),
    };
    cards = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((e) => e),
      save: jest.fn(async (e) => e),
      delete: jest.fn(),
    };
    const module = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: getRepositoryToken(TaskColumn), useValue: columns },
        { provide: getRepositoryToken(TaskCard), useValue: cards },
      ],
    }).compile();

    service = module.get(TasksService);
  });

  it('puts a new column after the last one', async () => {
    columns.find.mockResolvedValue([{ position: 4 }]);

    const column = await service.createColumn(7, '  Doing ');

    expect(column).toMatchObject({ title: 'Doing', position: 5, cards: [] });
  });

  it('refuses to delete a column that still has active cards', async () => {
    columns.findOne.mockResolvedValue({ id: 2, userId: 7 });
    cards.count.mockResolvedValue(1);

    await expect(service.deleteColumn(2, 7)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(columns.delete).not.toHaveBeenCalled();
  });

  it('does not create a card in another user’s column', async () => {
    columns.findOne.mockResolvedValue(null);

    await expect(
      service.createCard(7, { columnId: 9, title: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('archives and restores a card', async () => {
    const card = {
      id: 3,
      userId: 7,
      columnId: 1,
      archivedAt: null,
      position: 0,
    };

    cards.findOne.mockResolvedValue(card);
    const archived = await service.updateCard(3, 7, { archived: true });

    expect(archived.archivedAt).toBeInstanceOf(Date);

    const restored = await service.updateCard(3, 7, { archived: false });

    expect(restored.archivedAt).toBeNull();
  });

  it('moves a card to the requested index of another column and renumbers', async () => {
    const moving = {
      id: 1,
      userId: 7,
      columnId: 1,
      archivedAt: null,
      position: 0,
    };
    const a = { id: 10, columnId: 2, position: 0 };
    const b = { id: 11, columnId: 2, position: 1 };

    cards.findOne.mockResolvedValue(moving);
    columns.findOne.mockResolvedValue({ id: 2, userId: 7 });
    cards.find.mockResolvedValueOnce([a, b]).mockResolvedValue([]);

    await service.moveCard(1, 7, { columnId: 2, position: 1 });

    const saved = cards.save.mock.calls[0][0];

    expect(saved.map((c: { id: number }) => c.id)).toEqual([10, 1, 11]);
    expect(saved.map((c: { position: number }) => c.position)).toEqual([
      0, 1, 2,
    ]);
    expect(moving.columnId).toBe(2);
  });
});
