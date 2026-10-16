import { ChatController } from './chat.controller';

// Only the list route's query handling is under test: the controller is built without the rest of its dependencies.
function controllerWith(chatService: object): ChatController {
  return Object.assign(Object.create(ChatController.prototype), {
    chatService,
  }) as ChatController;
}

describe('ChatController listMessages — updatedAfter', () => {
  const make = () => {
    const chatService = {
      listMessages: jest.fn().mockResolvedValue([]),
      listAttachments: jest.fn().mockResolvedValue([]),
    };

    return { chatService, controller: controllerWith(chatService) };
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
