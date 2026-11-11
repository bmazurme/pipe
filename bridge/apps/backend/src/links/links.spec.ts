import {
  assessChannels,
  Channel,
  classifyFailure,
  ProbeResult,
  ProbeRow,
  RESULT_TEXT,
  STALE_AFTER_MS,
} from './links';

const NOW = new Date('2026-11-11T12:00:00Z');
const fresh = new Date(NOW.getTime() - 30_000);
const old = new Date(NOW.getTime() - STALE_AFTER_MS - 60_000);

const channel = (host: string, name = host): Channel => ({
  key: `${host}:443`,
  name,
  host,
  port: 443,
  sni: 'example.com',
});
const probe = (
  vantage: string,
  host: string,
  result: ProbeResult = 'ok',
  probedAt = fresh,
): ProbeRow => ({
  vantage,
  channelKey: `${host}:443`,
  result,
  tcpMs: result === 'ok' ? 20 : null,
  tlsMs: result === 'ok' ? 40 : null,
  detail: null,
  probedAt,
  changedAt: new Date('2026-11-11T10:00:00Z'),
});

describe('classifyFailure', () => {
  it.each([
    ['tcp', 'ETIMEDOUT', false, 'tcp_timeout'],
    ['tcp', undefined, true, 'tcp_timeout'],
    ['tcp', 'ECONNREFUSED', false, 'tcp_refused'],
    ['tcp', 'ENETUNREACH', false, 'error'],
    ['tcp', 'EHOSTUNREACH', false, 'error'],
    ['tls', undefined, true, 'tls_timeout'],
    ['tls', 'ETIMEDOUT', false, 'tls_timeout'],
    ['tls', 'ECONNRESET', false, 'tls_reset'],
    ['tls', 'EPIPE', false, 'tls_reset'],
    ['tls', 'ERR_SSL_WRONG_VERSION_NUMBER', false, 'tls_error'],
  ] as const)(
    '%s stage, code %s, timer %s → %s',
    (stage, code, timedOut, expected) => {
      expect(
        classifyFailure(stage, code ? { code } : undefined, timedOut).result,
      ).toBe(expected);
    },
  );

  it('keeps the error code as the detail, or a short message', () => {
    expect(classifyFailure('tcp', { code: 'ECONNREFUSED' }, false).detail).toBe(
      'ECONNREFUSED',
    );
    expect(
      classifyFailure('tls', { message: 'x'.repeat(300) }, false).detail,
    ).toHaveLength(120);
    expect(classifyFailure('tcp', undefined, true).detail).toBeNull();
  });

  it('has words for every result', () => {
    for (const text of Object.values(RESULT_TEXT))
      expect(text.length).toBeGreaterThan(3);
  });
});

describe('assessChannels', () => {
  it('is ok when every channel answers from every point', () => {
    const view = assessChannels(
      [channel('a'), channel('b')],
      [
        probe('bridge', 'a'),
        probe('bridge', 'b'),
        probe('home', 'a'),
        probe('home', 'b'),
      ],
      NOW,
    );

    expect(view.status).toBe('ok');
    expect(view.reasons).toEqual([]);
    expect(view.channels.map((c) => c.state)).toEqual(['ok', 'ok']);
    expect(view.vantages.map((v) => v.name)).toEqual(['bridge', 'home']);
  });

  it('says a channel is partial and from where it does not answer — the case of a server blocked from home only', () => {
    const view = assessChannels(
      [channel('a', 'blocked'), channel('b', 'fine')],
      [
        probe('bridge', 'a', 'tcp_timeout'),
        probe('cloud', 'a'),
        probe('bridge', 'b'),
        probe('cloud', 'b'),
      ],
      NOW,
    );

    expect(view.channels[0].state).toBe('partial');
    expect(view.channels[0].reason).toBe(
      'не доходит из: bridge — нет ответа на SYN (порт или адрес отфильтрован)',
    );
    expect(view.status).toBe('warn');
    expect(view.reasons).toEqual([
      'Канал blocked: не доходит из: bridge — нет ответа на SYN (порт или адрес отфильтрован)',
    ]);
  });

  it('says a channel is down when no point reaches it, but the pool is fine while another channel lives', () => {
    const view = assessChannels(
      [channel('a', 'dead'), channel('b'), channel('c')],
      [
        probe('bridge', 'a', 'tls_reset'),
        probe('bridge', 'b'),
        probe('bridge', 'c'),
      ],
      NOW,
    );

    expect(view.channels[0]).toMatchObject({
      state: 'down',
      reason: 'не доходит ни из одной точки: сброс после рукопожатия (DPI?)',
    });
    expect(view.status).toBe('warn');
  });

  it('warns when only one live channel is left among several', () => {
    const view = assessChannels(
      [channel('a'), channel('b', 'last')],
      [probe('bridge', 'a', 'tcp_timeout'), probe('bridge', 'b')],
      NOW,
    );

    expect(view.status).toBe('warn');
    expect(view.reasons[0]).toBe('Остался один живой канал: last');
  });

  it('is bad when no channel answers from any point', () => {
    const view = assessChannels(
      [channel('a'), channel('b')],
      [
        probe('bridge', 'a', 'tcp_timeout'),
        probe('bridge', 'b', 'tls_reset'),
        probe('home', 'a', 'tcp_timeout'),
      ],
      NOW,
    );

    expect(view.status).toBe('bad');
    expect(view.reasons[0]).toBe('Ни один канал не доходит ни из одной точки');
  });

  it('is not bad for a single channel that is the only one (nothing to lose a spare of)', () => {
    const view = assessChannels([channel('a')], [probe('bridge', 'a')], NOW);

    expect(view.status).toBe('ok');
  });

  it('ignores a probe that is too old, and says the point stopped reporting', () => {
    const view = assessChannels(
      [channel('a'), channel('b')],
      [
        probe('bridge', 'a'),
        probe('bridge', 'b'),
        probe('home', 'a', 'ok', old),
        probe('home', 'b', 'tcp_timeout', old),
      ],
      NOW,
    );

    // the old failing probe from home does not make b partial
    expect(view.channels.map((c) => c.state)).toEqual(['ok', 'ok']);
    expect(view.vantages.find((v) => v.name === 'home')?.stale).toBe(true);
    expect(view.status).toBe('warn');
    expect(view.reasons).toEqual(['Точка «home» не присылает пробы']);
    expect(
      view.channels[0].cells.find((c) => c.vantage === 'home')?.stale,
    ).toBe(true);
  });

  it('is "unknown" for a channel nobody probed lately, and warns that nothing is probing when that is every channel', () => {
    const view = assessChannels([channel('a')], [], NOW);

    expect(view.channels[0].state).toBe('unknown');
    expect(view.status).toBe('warn');
    expect(view.reasons).toEqual([
      'Нет свежих проб каналов — проверка не запущена или не присылает данные',
    ]);
  });

  it('is ok with no channels at all (nothing configured is not a failure here)', () => {
    expect(assessChannels([], [], NOW)).toEqual({
      status: 'ok',
      reasons: [],
      channels: [],
      vantages: [],
    });
  });

  it('does not count probes of a channel that is no longer in any connection', () => {
    const view = assessChannels(
      [channel('a')],
      [probe('bridge', 'a'), probe('bridge', 'gone', 'tcp_timeout')],
      NOW,
    );

    expect(view.status).toBe('ok');
    expect(view.channels).toHaveLength(1);
  });

  it('carries the timings, the detail and since when the result holds', () => {
    const row = {
      ...probe('bridge', 'a', 'tcp_refused'),
      detail: 'ECONNREFUSED',
    };
    const [cell] = assessChannels([channel('a')], [row], NOW).channels[0].cells;

    expect(cell).toMatchObject({
      vantage: 'bridge',
      result: 'tcp_refused',
      detail: 'ECONNREFUSED',
      changedAt: '2026-11-11T10:00:00.000Z',
      stale: false,
    });
  });
});
