import {
  AlertGate,
  BURST_LIMIT,
  BURST_WINDOW_MS,
  buildBurstMessage,
  DAILY_NOISY,
  DAILY_TARGET,
  DEDUPE_MS,
  kindOf,
  URGENT_DEDUPE_MS,
  verdictOf,
} from './alert-budget';

const T0 = 1_800_000_000_000;

describe('AlertGate dedupe', () => {
  it('says the first message, and not the same one again within the window', () => {
    const gate = new AlertGate();

    expect(gate.decide('Нет данных', false, T0)).toBe('send');
    gate.remember('Нет данных', T0);
    expect(gate.decide('Нет данных', false, T0 + 60_000)).toBe('dedupe');
    expect(gate.decide('Нет данных', false, T0 + DEDUPE_MS - 1)).toBe('dedupe');
    expect(gate.decide('Нет данных', false, T0 + DEDUPE_MS)).toBe('send');
  });

  it('compares the EXACT text: two events that differ only by a number are two events', () => {
    const gate = new AlertGate();

    gate.remember('🔀 Задача #7 → PR #55', T0);

    expect(gate.decide('🔀 Задача #8 → PR #56', false, T0 + 1000)).toBe('send');
  });

  it('forgets a message after the window, and a message the gate was told about while it was queued counts too', () => {
    const gate = new AlertGate();

    gate.remember('x', T0);
    expect(gate.decide('x', false, T0 + 10)).toBe('dedupe');
  });

  it('deduplicates an urgent message too, over a shorter window', () => {
    const gate = new AlertGate();

    gate.remember('🔴 канал недоступен', T0);

    expect(
      gate.decide('🔴 канал недоступен', true, T0 + URGENT_DEDUPE_MS - 1),
    ).toBe('dedupe');
    expect(
      gate.decide('🔴 канал недоступен', true, T0 + URGENT_DEDUPE_MS),
    ).toBe('send');
    // …which is shorter than an ordinary message's.
    expect(
      gate.decide('🔴 канал недоступен', false, T0 + URGENT_DEDUPE_MS),
    ).toBe('dedupe');
  });

  it('does not grow without bound', () => {
    const gate = new AlertGate();

    for (let i = 0; i < 2000; i++) gate.remember(`m${i}`, T0 + i);

    // The newest are still remembered, the oldest are gone.
    expect(gate.decide('m1999', false, T0 + 2000)).toBe('dedupe');
    expect(gate.decide('m0', false, T0 + 2000)).toBe('send');
  });
});

describe('AlertGate bursts', () => {
  const sendN = (gate: AlertGate, n: number, at: number) => {
    for (let i = 0; i < n; i++) gate.recordSent(at + i);
  };

  it(`lets ${BURST_LIMIT} ordinary messages through, then holds the rest`, () => {
    const gate = new AlertGate();

    sendN(gate, BURST_LIMIT, T0);

    expect(gate.decide('another', false, T0 + 1000)).toBe('hold');
  });

  it('is calm again after the window', () => {
    const gate = new AlertGate();

    sendN(gate, BURST_LIMIT, T0);

    expect(
      gate.decide('another', false, T0 + BURST_WINDOW_MS + BURST_LIMIT),
    ).toBe('send');
  });

  it('never holds an urgent message: it cannot wait for the group', () => {
    const gate = new AlertGate();

    sendN(gate, 10, T0);

    expect(gate.decide('🔴 канал недоступен', true, T0 + 1000)).toBe('send');
  });

  it('does not count held or repeated messages as sent', () => {
    const gate = new AlertGate();

    sendN(gate, BURST_LIMIT - 1, T0);

    expect(gate.decide('a', false, T0 + 10)).toBe('send');
  });
});

describe('kindOf and the burst message', () => {
  it('names a kind by its first line with the numbers taken out', () => {
    expect(
      kindOf('🔴 Задача #7: не удалось открыть PR — boom\nsecond line'),
    ).toBe(kindOf('🔴 Задача #9: не удалось открыть PR — boom'));
    expect(kindOf('x'.repeat(200))).toHaveLength(60);
    expect(kindOf('')).toBe('');
  });

  it('groups what a burst held back, one line each', () => {
    const text = buildBurstMessage([
      { text: '▶️ Запуск #1\nподробности', time: '10:01' },
      { text: '▶️ Запуск #2', time: '10:01' },
    ]);

    expect(text).toBe(
      '🔔 Ещё 2 подряд (сгруппировано):\n• 10:01 ▶️ Запуск #1\n• 10:01 ▶️ Запуск #2',
    );
  });
});

describe('verdictOf', () => {
  it('is ok within the target, over above it, noisy far above it', () => {
    expect(verdictOf(0)).toBe('ok');
    expect(verdictOf(DAILY_TARGET)).toBe('ok');
    expect(verdictOf(DAILY_TARGET + 1)).toBe('over');
    expect(verdictOf(DAILY_NOISY - 1)).toBe('over');
    expect(verdictOf(DAILY_NOISY)).toBe('noisy');
  });
});
