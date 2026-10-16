import type { Response } from 'express';

import { RunCredentialsService } from '../worker/run-credentials.service';
import { WorkersService } from '../worker/workers.service';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

describe('ChatController.claim', () => {
  const claimed = {
    message: { id: 11 },
    chat: { id: 3, model: 'sonnet' },
    history: [],
  };

  function setup(resolve: jest.Mock) {
    const chatService = {
      claim: jest.fn().mockResolvedValue(claimed),
      failTurn: jest.fn().mockResolvedValue({}),
    };
    const controller = new ChatController(
      chatService as unknown as ChatService,
      {} as WorkersService,
      { resolve } as unknown as RunCredentialsService,
    );
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      end: jest.fn(),
    };

    return { chatService, controller, res: res as unknown as Response };
  }

  it('fails the turn and rethrows when credentials cannot be resolved', async () => {
    const error = new Error('no token stored');
    const { chatService, controller, res } = setup(
      jest.fn().mockRejectedValue(error),
    );

    await expect(controller.claim({ id: 7 }, res)).rejects.toBe(error);

    expect(chatService.failTurn).toHaveBeenCalledWith(
      11,
      7,
      expect.stringContaining('no token stored'),
    );
  });

  it('does not fail the turn when credentials resolve', async () => {
    const { chatService, controller, res } = setup(
      jest.fn().mockResolvedValue({ claudeToken: 't', provider: null }),
    );

    await controller.claim({ id: 7 }, res);

    expect(chatService.failTurn).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
  });
});
