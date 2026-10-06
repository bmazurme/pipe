import { TelegramCommandsService } from './telegram-commands.service';

function setup() {
  const loop = { statusText: jest.fn().mockResolvedValue('STATUS') };
  const telegram = {
    chatId: () => '42',
    send: jest.fn().mockResolvedValue(true),
  };

  return {
    service: new TelegramCommandsService(loop as never, telegram as never),
    telegram,
  };
}

const msg = (text: string, id = 42) => ({ message: { text, chat: { id } } });

describe('TelegramCommandsService', () => {
  it('answers /status with the loop status', async () => {
    const { service, telegram } = setup();

    await service.handle(msg('/status'));

    expect(telegram.send).toHaveBeenCalledWith('STATUS');
  });

  it('accepts the @botname suffix and is case-insensitive', async () => {
    const { service, telegram } = setup();

    await service.handle(msg('/STATUS@ntlstl_bot'));

    expect(telegram.send).toHaveBeenCalledWith('STATUS');
  });

  it('answers /help and /start with the help text', async () => {
    const { service, telegram } = setup();

    await service.handle(msg('/help'));
    await service.handle(msg('/start'));

    expect(telegram.send).toHaveBeenCalledTimes(2);
  });

  it('ignores other chats, unknown commands and non-text updates', async () => {
    const { service, telegram } = setup();

    await service.handle(msg('/status', 7));
    await service.handle(msg('hello'));
    await service.handle({});

    expect(telegram.send).not.toHaveBeenCalled();
  });
});
