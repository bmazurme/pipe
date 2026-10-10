import { NotFoundException } from '@nestjs/common';

import { ContextController } from './context.controller';
import { ContextService } from './context.service';
import { Context } from './entities/context.entity';

describe('ContextController', () => {
  let controller: ContextController;
  let service: { findAllByUser: jest.Mock; findOwned: jest.Mock };

  const stored = {
    id: 1,
    userId: 7,
    name: 'Notes',
    content: 'secret text',
    contentLength: 11,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
  } as Context;

  beforeEach(() => {
    service = { findAllByUser: jest.fn(), findOwned: jest.fn() };
    controller = new ContextController(service as unknown as ContextService);
  });

  it('lists summaries without the text', async () => {
    service.findAllByUser.mockResolvedValue([stored]);

    const result = await controller.list({ id: 7 });

    expect(service.findAllByUser).toHaveBeenCalledWith(7);
    expect(result).toEqual([
      {
        id: 1,
        name: 'Notes',
        contentLength: 11,
        createdAt: stored.createdAt,
        updatedAt: stored.updatedAt,
      },
    ]);
    expect(result[0]).not.toHaveProperty('content');
  });

  it('returns the full text of an owned context', async () => {
    service.findOwned.mockResolvedValue(stored);

    const result = await controller.get(1, { id: 7 });

    expect(service.findOwned).toHaveBeenCalledWith(1, 7);
    expect(result.content).toBe('secret text');
  });

  it('404s on another user’s context', async () => {
    service.findOwned.mockRejectedValue(new NotFoundException());

    await expect(controller.get(1, { id: 8 })).rejects.toThrow(
      NotFoundException,
    );
  });
});
