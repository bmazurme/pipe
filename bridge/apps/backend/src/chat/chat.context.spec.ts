import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ContextService } from '../context/context.service';
import { WorkerService } from '../worker/worker.service';
import { FILE_STORE } from '../storage/file-store/file-store';
import { ChatAttachmentsService } from './chat-attachments.service';
import { ChatService } from './chat.service';
import { ChatResponseDto } from './dto/chat-response.dto';
import { Chat, ChatModel } from './entities/chat.entity';
import { ChatAttachment } from './entities/chat-attachment.entity';
import { ChatMessage } from './entities/chat-message.entity';

describe('ChatService context snapshot', () => {
  let service: ChatService;
  let save: jest.Mock;
  let findOwned: jest.Mock;

  beforeEach(async () => {
    save = jest.fn((c: object) => Promise.resolve({ id: 1, ...c }));
    findOwned = jest.fn();

    const module = await Test.createTestingModule({
      providers: [
        ChatService,
        ChatAttachmentsService,
        { provide: getRepositoryToken(Chat), useValue: { save } },
        { provide: getRepositoryToken(ChatMessage), useValue: {} },
        { provide: getRepositoryToken(ChatAttachment), useValue: {} },
        { provide: FILE_STORE, useValue: {} },
        { provide: ContextService, useValue: { findOwned } },
        { provide: WorkerService, useValue: { findOwned: jest.fn() } },
      ],
    }).compile();

    service = module.get(ChatService);
  });

  it('snapshots the name and text of the caller’s context', async () => {
    findOwned.mockResolvedValue({ id: 3, name: 'Rules', content: 'Use tabs' });

    await service.createChat(7, { model: ChatModel.Sonnet, contextId: 3 });

    expect(findOwned).toHaveBeenCalledWith(3, 7);
    expect(save).toHaveBeenCalledWith({
      userId: 7,
      model: ChatModel.Sonnet,
      title: null,
      contextName: 'Rules',
      contextText: 'Use tabs',
    });
  });

  it('propagates 404 for a context that is not the caller’s', async () => {
    findOwned.mockRejectedValue(new NotFoundException('Context not found'));

    await expect(
      service.createChat(7, { model: ChatModel.Sonnet, contextId: 99 }),
    ).rejects.toThrow(NotFoundException);
    expect(save).not.toHaveBeenCalled();
  });

  it('does not look up a context when none is given', async () => {
    await service.createChat(7, { model: ChatModel.Gpt });

    expect(findOwned).not.toHaveBeenCalled();
  });
});

describe('ChatResponseDto context', () => {
  it('exposes the context name but never its text', () => {
    const dto = ChatResponseDto.fromEntity({
      id: 1,
      model: ChatModel.Gpt,
      title: null,
      contextName: 'Rules',
      contextText: 'secret text',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Chat);

    expect(dto.contextName).toBe('Rules');
    expect(JSON.stringify(dto)).not.toContain('secret text');
  });
});
