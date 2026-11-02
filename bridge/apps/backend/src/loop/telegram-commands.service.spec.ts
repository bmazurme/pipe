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

describe('TelegramCommandsService: the router', () => {
  const cb = (data: string, id = 42) => ({
    callback_query: { id: 'q1', data, message: { chat: { id } } },
  });

  function withRouter() {
    const router = {
      statusText: jest.fn().mockResolvedValue('ROUTER STATUS'),
      requestFromTelegram: jest.fn().mockResolvedValue('REQUESTED'),
    };
    const telegram = {
      chatId: () => '42',
      send: jest.fn().mockResolvedValue(true),
      sendWithButtons: jest.fn().mockResolvedValue(true),
      answerCallback: jest.fn().mockResolvedValue(undefined),
    };
    const service = new TelegramCommandsService(
      {} as never,
      telegram as never,
      {} as never,
      {} as never,
      undefined,
      router as never,
    );

    return { service, router, telegram };
  }

  afterEach(() => jest.useRealTimers());

  it('/router shows the state with a button that only asks the question', async () => {
    const { service, telegram, router } = withRouter();

    await service.handle(msg('/router'));

    expect(router.statusText).toHaveBeenCalled();
    expect(telegram.sendWithButtons).toHaveBeenCalledWith('ROUTER STATUS', [
      [{ text: '🔄 Перезагрузить роутер', callback_data: 'rr:ask' }],
    ]);
    expect(router.requestFromTelegram).not.toHaveBeenCalled();
  });

  it('the first press asks for a confirmation, with a button that carries the minute it was asked in', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-03T12:00:30Z'));
    const { service, telegram, router } = withRouter();

    await service.handle(cb('rr:ask'));

    const [text, buttons] = telegram.sendWithButtons.mock.calls[0];

    expect(text).toContain('Перезагрузить роутер?');
    expect(buttons[0][0].callback_data).toBe(
      `rr:go:${Math.floor(new Date('2026-11-03T12:00:30Z').getTime() / 60_000)}`,
    );
    expect(buttons[0][1].callback_data).toBe('rr:no');
    expect(router.requestFromTelegram).not.toHaveBeenCalled();
  });

  it('the confirmation asks for the reboot and sends what the service answered', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-03T12:03:00Z'));
    const { service, telegram, router } = withRouter();
    const asked = Math.floor(
      new Date('2026-11-03T12:00:30Z').getTime() / 60_000,
    );

    await service.handle(cb(`rr:go:${asked}`));

    expect(router.requestFromTelegram).toHaveBeenCalledTimes(1);
    expect(telegram.send).toHaveBeenCalledWith('REQUESTED');
  });

  it('refuses a confirmation older than five minutes', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-03T12:10:00Z'));
    const { service, telegram, router } = withRouter();
    const asked = Math.floor(
      new Date('2026-11-03T12:00:30Z').getTime() / 60_000,
    );

    await service.handle(cb(`rr:go:${asked}`));

    expect(router.requestFromTelegram).not.toHaveBeenCalled();
    expect(telegram.answerCallback).toHaveBeenCalledWith(
      'q1',
      'Кнопка устарела',
    );
    expect(telegram.send).toHaveBeenCalledWith(
      expect.stringContaining('устарела'),
    );
  });

  it('cancel does nothing but answer', async () => {
    const { service, telegram, router } = withRouter();

    await service.handle(cb('rr:no'));

    expect(telegram.answerCallback).toHaveBeenCalledWith('q1', 'Отменено');
    expect(router.requestFromTelegram).not.toHaveBeenCalled();
  });

  it("ignores the presses from any chat but the owner's", async () => {
    const { service, router, telegram } = withRouter();

    await service.handle(cb('rr:go:1', 999));
    await service.handle(cb('rr:ask', 999));

    expect(router.requestFromTelegram).not.toHaveBeenCalled();
    expect(telegram.sendWithButtons).not.toHaveBeenCalled();
  });

  it('knows nothing of the router when the service is not there', async () => {
    const { service, telegram } = setup();

    await service.handle(msg('/router'));

    expect(telegram.send).not.toHaveBeenCalled();
  });
});
