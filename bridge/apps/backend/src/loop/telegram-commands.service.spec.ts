import { TelegramCommandsService } from './telegram-commands.service';

function setup() {
  const loop = { statusText: jest.fn().mockResolvedValue('STATUS') };
  const telegram = {
    chatId: () => '42',
    send: jest.fn().mockResolvedValue(true),
    answerCallback: jest.fn().mockResolvedValue(undefined),
  };

  const merges = { merge: jest.fn().mockResolvedValue('MERGED') };

  return {
    service: new TelegramCommandsService(
      loop as never,
      telegram as never,
      merges as never,
    ),
    telegram,
    merges,
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

describe('TelegramCommandsService callbacks', () => {
  const press = (data: string, chat = 42) => ({
    callback_query: { id: 'cb1', data, message: { chat: { id: chat } } },
  });

  it('merges on a valid merge button from the owner chat and reports the outcome', async () => {
    const { service, telegram, merges } = setup();

    await service.handle(press('merge:12:abc1234'));

    expect(merges.merge).toHaveBeenCalledWith(12, 'abc1234');
    expect(telegram.answerCallback).toHaveBeenCalledWith(
      'cb1',
      expect.any(String),
    );
    expect(telegram.send).toHaveBeenCalledWith('MERGED');
  });

  it('ignores a press from any other chat', async () => {
    const { service, merges, telegram } = setup();

    await service.handle(press('merge:12:abc1234', 7));

    expect(merges.merge).not.toHaveBeenCalled();
    expect(telegram.answerCallback).not.toHaveBeenCalled();
  });

  it('ignores malformed or unknown callback data', async () => {
    const { service, merges } = setup();

    for (const data of [
      'merge:12',
      'merge:x:abc1234',
      'delete:1:abc1234',
      'merge:12:ZZZZZZZ',
      '',
    ]) {
      await service.handle(press(data));
    }

    expect(merges.merge).not.toHaveBeenCalled();
  });
});
