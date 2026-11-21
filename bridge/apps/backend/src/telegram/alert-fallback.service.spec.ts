import type { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';

import { AlertFallbackService } from './alert-fallback.service';

function make(values: Record<string, string> = {}) {
  const service = new AlertFallbackService({
    get: (key: string) => values[key],
  } as unknown as ConfigService);
  // nodemailer's own test transport: builds the message, sends nothing
  const sent: { to: string; subject: string; text: string }[] = [];
  const transport = createTransport({ jsonTransport: true });
  const sendMail = jest
    .spyOn(transport, 'sendMail')
    .mockImplementation(((message: {
      to: string;
      subject: string;
      text: string;
    }) => {
      sent.push(message);

      return Promise.resolve({});
    }) as never) as unknown as jest.Mock;

  service.transportFactory = () => transport;

  return { service, sent, sendMail };
}

const WEBHOOK = { ALERT_WEBHOOK_URL: 'https://ntfy.example.org/secret-topic' };
const EMAIL = {
  ALERT_SMTP_URL: 'smtps://user:pass@smtp.example.org:465',
  ALERT_EMAIL_TO: 'owner@example.org',
};

describe('AlertFallbackService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('is not configured by default, and says what is configured without any secret', () => {
    expect(make().service.isConfigured()).toBe(false);
    expect(make().service.channels()).toEqual([]);

    const both = make({
      ...WEBHOOK,
      ...EMAIL,
      ALERT_WEBHOOK_TOKEN: 'tkn',
    }).service;

    expect(both.channels()).toEqual([
      { name: 'webhook', target: 'ntfy.example.org' },
      { name: 'email', target: 'owner@example.org' },
    ]);
    expect(JSON.stringify(both.channels())).not.toMatch(
      /secret-topic|pass|tkn/,
    );
  });

  it('ignores a webhook that is not a URL, and an e-mail address without a server', () => {
    expect(
      make({ ALERT_WEBHOOK_URL: 'not a url' }).service.isConfigured(),
    ).toBe(false);
    expect(
      make({ ALERT_EMAIL_TO: 'owner@example.org' }).service.isConfigured(),
    ).toBe(false);
  });

  it('posts the text to an ntfy-style webhook as plain text, with the token if there is one', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true } as Response);
    const { service } = make({ ...WEBHOOK, ALERT_WEBHOOK_TOKEN: 'tkn' });

    await expect(service.send('Telegram недоступен')).resolves.toBe(true);

    const [url, init] = fetchSpy.mock.calls[0];
    const request = init as RequestInit & { headers: Record<string, string> };

    expect(url).toBe('https://ntfy.example.org/secret-topic');
    expect(request.method).toBe('POST');
    expect(request.body).toBe('Telegram недоступен');
    expect(request.headers).toMatchObject({
      Priority: 'high',
      Authorization: 'Bearer tkn',
    });
  });

  it('can post JSON instead', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true } as Response);

    await make({ ...WEBHOOK, ALERT_WEBHOOK_FORMAT: 'json' }).service.send('hi');

    const request = fetchSpy.mock.calls[0][1] as RequestInit & {
      headers: Record<string, string>;
    };

    expect(request.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(request.body as string)).toEqual({
      text: 'hi',
      message: 'hi',
    });
  });

  it('sends an e-mail with the first line as the subject', async () => {
    const { service, sent } = make(EMAIL);

    await expect(
      service.send('Telegram недоступен\nподробности'),
    ).resolves.toBe(true);

    expect(sent).toEqual([
      expect.objectContaining({
        to: 'owner@example.org',
        subject: 'pipe: Telegram недоступен',
        text: 'Telegram недоступен\nподробности',
      }),
    ]);
  });

  it('reports delivery when any channel took it, and never throws when none did', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('unreachable'));
    const { service, sendMail } = make({ ...WEBHOOK, ...EMAIL });

    sendMail.mockRejectedValueOnce(new Error('smtp down'));
    await expect(service.send('x')).resolves.toBe(false);

    sendMail.mockResolvedValueOnce({} as never);
    await expect(service.send('y')).resolves.toBe(true);
  });

  it('counts a webhook answer other than 2xx as not delivered', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: false, status: 401 } as Response);

    await expect(make(WEBHOOK).service.send('x')).resolves.toBe(false);
  });

  it('holds urgent notices that arrive together and sends them as one message, without repeating a text', async () => {
    jest.useFakeTimers();
    const { service, sent } = make(EMAIL);

    service.mirror('VPN: канал упал');
    service.mirror('Деплой: ошибка');
    service.mirror('VPN: канал упал');

    expect(sent).toHaveLength(0);

    await jest.advanceTimersByTimeAsync(5_000);

    expect(sent).toHaveLength(1);
    expect(sent[0].text).toBe(
      'Telegram недоступен, срочные уведомления:\n• VPN: канал упал\n• Деплой: ошибка',
    );

    // the same text again soon after is not sent again
    service.mirror('VPN: канал упал');
    await jest.advanceTimersByTimeAsync(5_000);

    expect(sent).toHaveLength(1);
  });

  it('does nothing when no channel is set up', async () => {
    jest.useFakeTimers();
    const { service, sent } = make();

    service.mirror('anything');
    await jest.advanceTimersByTimeAsync(10_000);

    expect(sent).toHaveLength(0);
  });
});
