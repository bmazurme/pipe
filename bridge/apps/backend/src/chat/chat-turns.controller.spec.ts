import { HttpStatus } from '@nestjs/common';

import { ChatTurnsController } from './chat-turns.controller';

function controllerWith(deps: object): ChatTurnsController {
  return Object.assign(
    Object.create(ChatTurnsController.prototype),
    deps,
  ) as ChatTurnsController;
}

describe('ChatTurnsController claim', () => {
  const res = () => {
    const r = {
      status: jest.fn().mockReturnThis(),
      end: jest.fn(),
      json: jest.fn(),
    };
    return r;
  };

  it('answers 204 and skips the chat service when the worker may not take a turn', async () => {
    const chatService = { claim: jest.fn() };
    const controller = controllerWith({
      chatService,
      workersService: { mayTakeChatTurn: jest.fn().mockResolvedValue(false) },
    });
    const r = res();

    await controller.claim({ id: 1, workerId: 7 }, r as never);

    expect(chatService.claim).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(HttpStatus.NO_CONTENT);
  });

  it('fails the turn and rethrows when credentials cannot be resolved', async () => {
    const error = new Error('no token');
    const chatService = {
      claim: jest.fn().mockResolvedValue({
        chat: { id: 2, model: 'sonnet', contextText: null },
        message: { id: 3 },
        history: [],
      }),
      failTurn: jest.fn().mockResolvedValue(undefined),
    };
    const controller = controllerWith({
      chatService,
      workersService: {},
      runCredentials: { resolve: jest.fn().mockRejectedValue(error) },
    });

    await expect(controller.claim({ id: 1 }, res() as never)).rejects.toBe(
      error,
    );
    expect(chatService.failTurn).toHaveBeenCalledWith(
      3,
      1,
      expect.stringContaining('no token'),
    );
  });

  it('returns the claimed turn payload', async () => {
    const chatService = {
      claim: jest.fn().mockResolvedValue({
        chat: { id: 2, model: 'sonnet', contextText: 'ctx' },
        message: { id: 3 },
        history: [],
      }),
    };
    const controller = controllerWith({
      chatService,
      workersService: {},
      runCredentials: {
        resolve: jest
          .fn()
          .mockResolvedValue({ claudeToken: 'tok', provider: null }),
      },
    });
    const r = res();

    await controller.claim({ id: 1 }, r as never);

    expect(r.json).toHaveBeenCalledWith({
      messageId: 3,
      chatId: 2,
      model: 'sonnet',
      provider: null,
      claudeToken: 'tok',
      context: 'ctx',
      history: [],
    });
  });
});
