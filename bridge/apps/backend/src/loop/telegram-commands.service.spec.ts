import { TelegramCommandsService } from './telegram-commands.service';

function setup() {
  const loop = { statusText: jest.fn().mockResolvedValue('STATUS') };
  const telegram = {
    chatId: () => '42',
    send: jest.fn().mockResolvedValue(true),
    answerCallback: jest.fn().mockResolvedValue(undefined),
  };

  const merges = { merge: jest.fn().mockResolvedValue('MERGED') };
  const boards = {
    approveFromTelegram: jest.fn().mockResolvedValue('APPROVED'),
  };

  return {
    service: new TelegramCommandsService(
      loop as never,
      telegram as never,
      merges as never,
      boards as never,
    ),
    telegram,
    merges,
    boards,
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

  describe('the board update button', () => {
    const press = (data: string, chat = 42) => ({
      callback_query: { id: 'q1', data, message: { chat: { id: chat } } },
    });

    it('lets the owner allow an update of a board at the commit shown on the button', async () => {
      const { service, telegram, boards } = setup();

      await service.handle(press('su:ubuntu-red:c823ea5'));

      expect(boards.approveFromTelegram).toHaveBeenCalledWith(
        'ubuntu-red',
        'c823ea5',
      );
      expect(telegram.send).toHaveBeenCalledWith('APPROVED');
    });

    it('ignores the button from any chat but the owner’s, and a malformed one', async () => {
      const { service, telegram, boards } = setup();

      await service.handle(press('su:ubuntu-red:c823ea5', 7));
      await service.handle(press('su:bad host:c823ea5'));
      await service.handle(press('su:ubuntu-red:xyz'));

      expect(boards.approveFromTelegram).not.toHaveBeenCalled();
      expect(telegram.send).not.toHaveBeenCalled();
    });
  });
});

describe('TelegramCommandsService kill-switch', () => {
  function withControl() {
    const control = {
      pause: jest.fn().mockResolvedValue(undefined),
      resume: jest.fn().mockResolvedValue(true),
    };
    const base = setup();
    const service = new TelegramCommandsService(
      { statusText: jest.fn() } as never,
      base.telegram as never,
      base.merges as never,
      base.boards as never,
      control as never,
    );

    return { service, control, telegram: base.telegram };
  }

  it('/pause stops the automation with the given reason, and says what it does and does not stop', async () => {
    const { service, control, telegram } = withControl();

    await service.handle(msg('/pause идёт релиз, не трогать'));

    expect(control.pause).toHaveBeenCalledWith(
      'идёт релиз, не трогать',
      'telegram',
    );
    expect(telegram.send).toHaveBeenCalledWith(
      expect.stringContaining('на паузе'),
    );
    expect(telegram.send).toHaveBeenCalledWith(
      expect.stringContaining('/resume'),
    );
  });

  it('/pause without a reason still records one', async () => {
    const { service, control } = withControl();

    await service.handle(msg('/pause'));

    expect(control.pause).toHaveBeenCalledWith(
      'остановлено командой /pause',
      'telegram',
    );
  });

  it('/resume continues, and says when there was nothing to resume', async () => {
    const { service, control, telegram } = withControl();

    await service.handle(msg('/resume'));
    expect(telegram.send).toHaveBeenLastCalledWith(
      expect.stringContaining('продолжает'),
    );

    control.resume.mockResolvedValue(false);
    await service.handle(msg('/resume'));
    expect(telegram.send).toHaveBeenLastCalledWith(
      expect.stringContaining('не была на паузе'),
    );
  });

  it('ignores the commands from anyone but the owner chat', async () => {
    const { service, control } = withControl();

    await service.handle(msg('/pause', 999));
    await service.handle(msg('/resume', 999));

    expect(control.pause).not.toHaveBeenCalled();
    expect(control.resume).not.toHaveBeenCalled();
  });
});
