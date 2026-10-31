import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';

import { ContextService } from '../context/context.service';
import { ProviderCredentialsService } from '../worker/provider-credentials.service';
import { WorkerService } from '../worker/worker.service';
import { ChatAttachmentsService } from './chat-attachments.service';
import { ChatService } from './chat.service';
import { ChatAttachment } from './entities/chat-attachment.entity';
import { Chat } from './entities/chat.entity';
import { ChatMessage } from './entities/chat-message.entity';

describe('ChatService.findAllByUser search', () => {
  let service: ChatService;
  let find: jest.Mock;
  let builder: Record<string, jest.Mock>;

  beforeEach(async () => {
    find = jest.fn().mockResolvedValue([]);
    builder = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([{ id: 1 }]),
    };
    const module = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: getRepositoryToken(Chat),
          useValue: { find, createQueryBuilder: jest.fn(() => builder) },
        },
        { provide: getRepositoryToken(ChatMessage), useValue: {} },
        { provide: ContextService, useValue: {} },
        { provide: WorkerService, useValue: {} },
        {
          provide: ProviderCredentialsService,
          useValue: { existsFor: jest.fn().mockResolvedValue(true) },
        },
        { provide: ChatAttachmentsService, useValue: {} },
        { provide: getRepositoryToken(ChatAttachment), useValue: {} },
      ],
    }).compile();
    service = module.get(ChatService);
  });

  it('without q keeps the plain listing', async () => {
    await service.findAllByUser(7);

    expect(find).toHaveBeenCalledWith({
      where: { userId: 7 },
      select: expect.not.arrayContaining(['contextText']),
      order: { updatedAt: 'DESC' },
    });
    expect(builder.where).not.toHaveBeenCalled();
  });

  it('searches title and message content, scoped to the user, newest first', async () => {
    const result = await service.findAllByUser(7, 'foo');

    expect(result).toEqual([{ id: 1 }]);
    expect(builder.where).toHaveBeenCalledWith('chat.userId = :userId', {
      userId: 7,
    });
    const [sql, params] = builder.andWhere.mock.calls[0] as [
      string,
      { pattern: string },
    ];
    expect(sql).toContain('chat.title ILIKE :pattern');
    expect(sql).toContain('EXISTS');
    expect(sql).toContain('m.content ILIKE :pattern');
    expect(params.pattern).toBe('%foo%');
    expect(builder.orderBy).toHaveBeenCalledWith('chat.updatedAt', 'DESC');
  });

  it('treats %, _ and backslash literally', async () => {
    await service.findAllByUser(7, '50%_a\\b');

    const [, params] = builder.andWhere.mock.calls[0] as [
      string,
      { pattern: string },
    ];
    expect(params.pattern).toBe('%50\\%\\_a\\\\b%');
  });

  it('the search branch selects no contextText', async () => {
    await service.findAllByUser(7, 'x');

    const cols = builder.select.mock.calls[0][0] as string[];
    expect(cols).toContain('chat.title');
    expect(cols).not.toContain('chat.contextText');
  });
});
