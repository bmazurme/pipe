import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ContextService } from '../context/context.service';
import { MAX_CONTEXT_LENGTH } from '../context/context.limits';
import { FILE_STORE } from '../storage/file-store/file-store';
import { JobStatus } from '../worker/entities/job.entity';
import { WorkerService } from '../worker/worker.service';
import { ChatAttachmentsService } from './chat-attachments.service';
import { ChatService } from './chat.service';
import { Chat } from './entities/chat.entity';
import { ChatAttachment } from './entities/chat-attachment.entity';
import { ChatMessage } from './entities/chat-message.entity';

const job = (over: object = {}) => ({
  id: 12,
  model: 'sonnet',
  status: JobStatus.Succeeded,
  errorMessage: null,
  logs: 'Built the box\nDone',
  finishedAt: new Date('2026-10-22T10:00:00Z'),
  ...over,
});

describe('ChatService.attachRunResult', () => {
  let service: ChatService;
  let chat: Record<string, unknown> | null;
  let findOwnedJob: jest.Mock;
  let save: jest.Mock;

  beforeEach(async () => {
    chat = { id: 5, userId: 7, contextName: null, contextText: null };
    findOwnedJob = jest.fn().mockResolvedValue(job());
    save = jest.fn((c: object) => Promise.resolve(c));

    const module = await Test.createTestingModule({
      providers: [
        ChatService,
        ChatAttachmentsService,
        {
          provide: getRepositoryToken(Chat),
          useValue: { findOne: () => Promise.resolve(chat), save },
        },
        { provide: getRepositoryToken(ChatMessage), useValue: {} },
        { provide: getRepositoryToken(ChatAttachment), useValue: {} },
        { provide: FILE_STORE, useValue: {} },
        { provide: ContextService, useValue: { findOwned: jest.fn() } },
        { provide: WorkerService, useValue: { findOwned: findOwnedJob } },
      ],
    }).compile();

    service = module.get(ChatService);
  });

  it('puts the run outcome into an empty context and names it after the run', async () => {
    const result = await service.attachRunResult(5, 7, 12);

    expect(findOwnedJob).toHaveBeenCalledWith(12, 7);
    expect(result.contextName).toBe('Запуск #12');
    expect(result.contextText).toContain('Run #12 (sonnet)');
    expect(result.contextText).toContain('Built the box');
  });

  it('appends to an existing context and extends its name', async () => {
    chat = { ...chat, contextName: 'Rules', contextText: 'Use tabs' };

    const result = await service.attachRunResult(5, 7, 12);

    expect(result.contextName).toBe('Rules + запуск #12');
    expect(result.contextText?.startsWith('Use tabs\n\nRun #12')).toBe(true);
  });

  it('refuses a job that has not finished', async () => {
    findOwnedJob.mockResolvedValue(job({ status: JobStatus.Running }));

    await expect(service.attachRunResult(5, 7, 12)).rejects.toThrow(
      ConflictException,
    );
    expect(save).not.toHaveBeenCalled();
  });

  it('refuses the same run twice', async () => {
    chat = { ...chat, contextText: 'Run #12 (sonnet) succeeded.' };

    await expect(service.attachRunResult(5, 7, 12)).rejects.toThrow(
      ConflictException,
    );
  });

  it('refuses when the context would outgrow the limit', async () => {
    chat = { ...chat, contextText: 'x'.repeat(MAX_CONTEXT_LENGTH) };

    await expect(service.attachRunResult(5, 7, 12)).rejects.toThrow(
      BadRequestException,
    );
    expect(save).not.toHaveBeenCalled();
  });

  it('propagates 404 for a chat that is not the caller’s', async () => {
    chat = null;

    await expect(service.attachRunResult(5, 7, 12)).rejects.toThrow(
      NotFoundException,
    );
  });
});
