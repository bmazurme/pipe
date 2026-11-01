import { BadRequestException } from '@nestjs/common';

import {
  ChatMessageRole,
  ChatMessageStatus,
} from '../chat/entities/chat-message.entity';
import { RouterClassifierService } from './router-classifier.service';
import { DEFAULT_SETTINGS } from './router-policy';
import { RouterSettingsService } from './router-settings.service';
import { RouterService } from './router.service';

describe('RouterClassifierService', () => {
  const answer = (over: Record<string, unknown>) => ({
    id: 2,
    role: ChatMessageRole.Assistant,
    status: ChatMessageStatus.Complete,
    content: '',
    ...over,
  });

  function build(messages: unknown[][]) {
    let poll = 0;
    const chats = {
      createChat: jest.fn().mockResolvedValue({ id: 11 }),
      renameChat: jest.fn().mockResolvedValue(undefined),
      sendMessage: jest.fn().mockResolvedValue({ assistantMessage: { id: 2 } }),
      listMessages: jest.fn(
        async () => messages[Math.min(poll++, messages.length - 1)],
      ),
      removeChat: jest.fn().mockResolvedValue(undefined),
    };

    return { chats, service: new RouterClassifierService(chats as never) };
  }

  it('asks Haiku in a chat of its own, reads the answer and deletes the chat again', async () => {
    const { chats, service } = build([
      [answer({ status: ChatMessageStatus.Running })],
      [answer({ content: '{"tier": 2, "needsGenerated": false}' })],
    ]);
    const result = await service.classify(
      7,
      { title: 'Fix', body: 'In a.ts' },
      { pollMs: 1 },
    );

    expect(result).toEqual({ tier: 2, needsGenerated: false });
    expect(chats.createChat).toHaveBeenCalledWith(7, { model: 'haiku' });
    expect(chats.sendMessage.mock.calls[0][2]).toContain('TASK TITLE: Fix');
    expect(chats.removeChat).toHaveBeenCalledWith(11, 7);
  });

  it('gives null — and still deletes the chat — when the answer fails, is unreadable, or does not come in time', async () => {
    for (const messages of [
      [[answer({ status: ChatMessageStatus.Failed })]],
      [[answer({ content: 'I cannot say' })]],
      [[answer({ status: ChatMessageStatus.Pending })]],
    ]) {
      const { chats, service } = build(messages);

      await expect(
        service.classify(
          7,
          { title: 't', body: 'b' },
          { pollMs: 1, timeoutMs: 20 },
        ),
      ).resolves.toBeNull();
      expect(chats.removeChat).toHaveBeenCalledTimes(1);
    }
  });

  it('gives null when the chat cannot even be made, and leaves nothing to delete', async () => {
    const { chats, service } = build([[]]);

    chats.createChat.mockRejectedValue(new Error('db down'));

    await expect(
      service.classify(7, { title: 't', body: 'b' }),
    ).resolves.toBeNull();
    expect(chats.removeChat).not.toHaveBeenCalled();
  });
});

describe('RouterService', () => {
  const settings = { get: jest.fn() };
  const classifier = { classify: jest.fn() };
  const router = new RouterService(settings as never, classifier as never);
  const request = {
    userId: 7,
    title: 'T',
    task: 'Fix a typo',
    executor: 'any' as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    settings.get.mockResolvedValue(DEFAULT_SETTINGS);
  });

  it('lets a model the owner named through untouched, with nothing decided and nobody asked', async () => {
    await expect(
      router.resolve({ ...request, model: 'opus' }),
    ).resolves.toEqual({ model: 'opus', routing: null });
    expect(classifier.classify).not.toHaveBeenCalled();
  });

  it("decides 'auto' by the size the classifier gives", async () => {
    classifier.classify.mockResolvedValue({ tier: 4, needsGenerated: false });

    const { model, routing } = await router.resolve({
      ...request,
      model: 'auto',
    });

    expect(model).toBe('opus');
    expect(routing).toMatchObject({ source: 'classifier', tier: 4 });
    expect(classifier.classify).toHaveBeenCalledWith(7, {
      title: 'T',
      body: 'Fix a typo',
    });
  });

  it('does not ask how big a task is when a rule decides it by words', async () => {
    settings.get.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      rules: [
        { name: 'Fusion', keywords: 'fusion', model: 'opus', enabled: true },
      ],
    });

    const { model, routing } = await router.resolve({
      ...request,
      task: 'Моделируй во Fusion 360',
      model: 'auto',
    });

    expect(model).toBe('opus');
    expect(routing?.source).toBe('rule');
    expect(classifier.classify).not.toHaveBeenCalled();
  });

  it('falls back to Sonnet when nobody answered', async () => {
    classifier.classify.mockResolvedValue(null);

    await expect(
      router.resolve({ ...request, model: 'auto' }),
    ).resolves.toMatchObject({
      model: 'sonnet',
      routing: { source: 'fallback' },
    });
  });

  it('can be tried out without starting anything', async () => {
    classifier.classify.mockResolvedValue({ tier: 1, needsGenerated: false });

    await expect(router.decide(request)).resolves.toMatchObject({
      model: 'haiku',
    });
  });
});

describe('RouterSettingsService', () => {
  const tiers = { 1: 'haiku', 2: 'haiku', 3: 'sonnet', 4: 'opus' } as const;
  let stored: Record<string, unknown> | null;
  const rows = {
    findOneBy: jest.fn(async () => stored),
    save: jest.fn(async (row: Record<string, unknown>) => (stored = row)),
  };
  const keys = { existsFor: jest.fn() };
  const service = new RouterSettingsService(rows as never, keys as never);

  beforeEach(() => {
    jest.clearAllMocks();
    stored = null;
    keys.existsFor.mockResolvedValue(true);
  });

  it('is the defaults until saved, and then what was saved (a missing tier filled from the defaults)', async () => {
    await expect(service.get(7)).resolves.toEqual(DEFAULT_SETTINGS);

    stored = { userId: 7, tierModels: { 1: 'sonnet' }, rules: [] };

    await expect(service.get(7)).resolves.toEqual({
      tierModels: { ...DEFAULT_SETTINGS.tierModels, 1: 'sonnet' },
      rules: [],
    });
  });

  it('saves a valid choice once per owner', async () => {
    await service.save(7, {
      tierModels: { ...tiers },
      rules: [
        {
          name: ' AliExpress ',
          keywords: 'aliexpress',
          model: 'opus',
          enabled: true,
        },
      ],
    });

    expect(rows.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        rules: [expect.objectContaining({ name: 'AliExpress' })],
      }),
    );

    stored = { id: 5, userId: 7, tierModels: tiers, rules: [] };
    await service.save(7, { tierModels: { ...tiers }, rules: [] });
    expect(rows.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 5, userId: 7 }),
    );
  });

  it("accepts the owner's own custom key and refuses someone else's, an unknown model, and 'auto' inside a tier", async () => {
    await expect(
      service.save(7, { tierModels: { ...tiers, 1: 'custom:3' }, rules: [] }),
    ).resolves.toBeDefined();

    keys.existsFor.mockResolvedValue(false);
    await expect(
      service.save(7, { tierModels: { ...tiers, 1: 'custom:3' }, rules: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.save(7, { tierModels: { ...tiers, 2: 'gemini' }, rules: [] }),
    ).rejects.toThrow('неизвестная модель');
    await expect(
      service.save(7, { tierModels: { ...tiers, 3: 'auto' }, rules: [] }),
    ).rejects.toThrow('неизвестная модель');
    expect(rows.save).toHaveBeenCalledTimes(1);
  });
});
