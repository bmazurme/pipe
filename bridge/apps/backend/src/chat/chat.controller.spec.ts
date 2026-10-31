import { ChatController } from './chat.controller';

// Only the list route's query handling is under test: the controller is built without the rest of its dependencies.
function controllerWith(
  chatService: object,
  chatAttachments: object = {},
): ChatController {
  return Object.assign(Object.create(ChatController.prototype), {
    chatService,
    chatAttachments,
  }) as ChatController;
}

describe('ChatController listMessages — updatedAfter', () => {
  const make = () => {
    const chatService = {
      listMessages: jest.fn().mockResolvedValue([]),
    };
    const chatAttachments = {
      attachmentsByMessage: jest.fn().mockResolvedValue(new Map()),
    };

    return {
      chatService,
      controller: controllerWith(chatService, chatAttachments),
    };
  };

  it('passes a valid date on to the service as a Date', async () => {
    const { chatService, controller } = make();

    await controller.listMessages(1, { id: 7 }, '2026-10-16T12:00:00.000Z');

    expect(chatService.listMessages).toHaveBeenCalledWith(
      1,
      7,
      new Date('2026-10-16T12:00:00.000Z'),
    );
  });

  it('returns the whole thread when it is absent', async () => {
    const { chatService, controller } = make();

    await controller.listMessages(1, { id: 7 });

    expect(chatService.listMessages).toHaveBeenCalledWith(1, 7, undefined);
  });

  it('answers 400 for something that is not a date', async () => {
    const { chatService, controller } = make();

    await expect(
      controller.listMessages(1, { id: 7 }, 'yesterday'),
    ).rejects.toThrow(/updatedAfter must be a valid date/);
    expect(chatService.listMessages).not.toHaveBeenCalled();
  });
});

describe('ChatController listMessages — attachments', () => {
  const message = (id: number) =>
    ({
      id,
      chatId: 1,
      role: 'user',
      content: `m${id}`,
      status: 'complete',
      createdAt: new Date('2026-10-16T12:00:00.000Z'),
      updatedAt: new Date('2026-10-16T12:00:00.000Z'),
    }) as unknown;

  it('makes no attachment query for an empty delta', async () => {
    const chatService = {
      listMessages: jest.fn().mockResolvedValue([]),
    };
    const chatAttachments = { attachmentsByMessage: jest.fn() };

    const result = await controllerWith(
      chatService,
      chatAttachments,
    ).listMessages(1, { id: 7 }, '2026-10-16T12:00:00.000Z');

    expect(result).toEqual([]);
    expect(chatAttachments.attachmentsByMessage).not.toHaveBeenCalled();
  });

  it('asks only for the returned messages and gives each its own files', async () => {
    const chatService = {
      listMessages: jest.fn().mockResolvedValue([message(5), message(6)]),
    };
    const chatAttachments = {
      attachmentsByMessage: jest.fn().mockResolvedValue(
        new Map([
          [
            6,
            [
              {
                id: 3,
                messageId: 6,
                originalName: 'shot.png',
                size: 5,
              },
            ],
          ],
        ]),
      ),
    };

    const result = await controllerWith(
      chatService,
      chatAttachments,
    ).listMessages(1, { id: 7 });

    expect(chatAttachments.attachmentsByMessage).toHaveBeenCalledWith([5, 6]);
    expect(result.map((m) => m.id)).toEqual([5, 6]);
    expect(result[0].attachments).toEqual([]);
    expect(result[1].attachments.map((a) => a.id)).toEqual([3]);
  });
});

describe('ChatController updateChat', () => {
  const chat = {
    id: 1,
    userId: 7,
    title: 'T',
    model: 'opus',
    createdAt: new Date('2026-10-16T12:00:00.000Z'),
    updatedAt: new Date('2026-10-16T12:00:00.000Z'),
  };

  it('switches the model when only model is given', async () => {
    const chatService = {
      changeModel: jest.fn().mockResolvedValue(chat),
      renameChat: jest.fn(),
    };

    await controllerWith(chatService).updateChat(
      1,
      { model: 'opus' } as never,
      {
        id: 7,
      },
    );

    expect(chatService.changeModel).toHaveBeenCalledWith(
      1,
      7,
      'opus',
      undefined,
    );
    expect(chatService.renameChat).not.toHaveBeenCalled();
  });

  it('still renames when only title is given', async () => {
    const chatService = {
      changeModel: jest.fn(),
      renameChat: jest.fn().mockResolvedValue(chat),
    };

    await controllerWith(chatService).updateChat(1, { title: 'T' }, { id: 7 });

    expect(chatService.renameChat).toHaveBeenCalledWith(1, 7, 'T');
    expect(chatService.changeModel).not.toHaveBeenCalled();
  });

  it('answers 400 when neither is given', async () => {
    await expect(
      controllerWith({}).updateChat(1, {}, { id: 7 }),
    ).rejects.toThrow(/название или модель/);
  });
});
