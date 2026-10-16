import type { ClaudeLimits } from './claude-limits';
import {
  evaluateLimits,
  formatAlert,
  formatResetIn,
  levelOf,
  type WindowState,
} from './limit-alerts';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const sec = (iso: string) => Date.parse(iso) / 1000;
const W1 = sec('2026-10-16T14:00:00Z');
const W2 = sec('2026-10-21T00:00:00Z');

const limits = (
  windows: Record<string, number>,
  over: Partial<ClaudeLimits> = {},
): ClaudeLimits => ({
  status: 'allowed',
  rateLimitType: null,
  isUsingOverage: false,
  windows: Object.fromEntries(
    Object.entries(windows).map(([name, utilization]) => [
      name,
      { utilization, resetsAt: name === 'five_hour' ? W1 : W2 },
    ]),
  ),
  reportedAt: '2026-10-16T12:00:00.000Z',
  ...over,
});

describe('levelOf', () => {
  it('is quiet below 80 %, then low, almost gone, used up', () => {
    expect([0, 0.5, 0.79].map((u) => levelOf(u, false))).toEqual([0, 0, 0]);
    expect([0.8, 0.94].map((u) => levelOf(u, false))).toEqual([1, 1]);
    expect([0.95, 0.99].map((u) => levelOf(u, false))).toEqual([2, 2]);
    expect(levelOf(1, false)).toBe(3);
    expect(levelOf(0.1, true)).toBe(3);
  });
});

describe('evaluateLimits', () => {
  it('says nothing while everything is comfortable, but remembers the windows', () => {
    const { alerts, state } = evaluateLimits(
      limits({ five_hour: 0.16, seven_day: 0.5 }),
      {},
    );

    expect(alerts).toEqual([]);
    expect(state.five_hour).toEqual({ level: 0, resetsAt: W1 });
  });

  it('announces a window when it crosses 80 %, once — not on every later report', () => {
    const first = evaluateLimits(limits({ seven_day: 0.82 }), {});

    expect(first.alerts).toEqual([
      { window: 'seven_day', level: 1, percent: 82, resetsAt: W2 },
    ]);

    const again = evaluateLimits(limits({ seven_day: 0.85 }), first.state);

    expect(again.alerts).toEqual([]);
  });

  it('announces again when the same window gets worse (95 %, then used up)', () => {
    let state: Record<string, WindowState> = {};

    state = evaluateLimits(limits({ seven_day: 0.82 }), state).state;

    const critical = evaluateLimits(limits({ seven_day: 0.96 }), state);

    expect(critical.alerts.map((a) => a.level)).toEqual([2]);

    const gone = evaluateLimits(
      limits(
        { seven_day: 1 },
        { status: 'rejected', rateLimitType: 'seven_day' },
      ),
      critical.state,
    );

    expect(gone.alerts.map((a) => a.level)).toEqual([3]);
    expect(
      evaluateLimits(
        limits(
          { seven_day: 1 },
          { status: 'rejected', rateLimitType: 'seven_day' },
        ),
        gone.state,
      ).alerts,
    ).toEqual([]);
  });

  it('jumps straight to the highest level it sees, with one message', () => {
    const { alerts } = evaluateLimits(limits({ seven_day: 0.97 }), {});

    expect(alerts).toHaveLength(1);
    expect(alerts[0].level).toBe(2);
  });

  it('starts over for a window that has rolled over (another reset time)', () => {
    const before: Record<string, WindowState> = {
      five_hour: { level: 2, resetsAt: W1 - 18000 },
    };
    const { alerts } = evaluateLimits(limits({ five_hour: 0.9 }), before);

    expect(alerts.map((a) => a.level)).toEqual([1]);
  });

  it('tracks each window on its own', () => {
    const { alerts } = evaluateLimits(
      limits({ five_hour: 0.9, seven_day: 0.3 }),
      {},
    );

    expect(alerts.map((a) => a.window)).toEqual(['five_hour']);
  });

  it('a rejected verdict names the window that ran out, whatever its number says', () => {
    const { alerts } = evaluateLimits(
      limits(
        { five_hour: 0.4, seven_day: 0.5 },
        { status: 'rejected', rateLimitType: 'five_hour' },
      ),
      {},
    );

    expect(alerts).toEqual([
      { window: 'five_hour', level: 3, percent: 40, resetsAt: W1 },
    ]);
  });

  it('a rejected verdict with no window at all is still announced once', () => {
    const first = evaluateLimits(
      limits({}, { status: 'rejected', rateLimitType: 'seven_day' }),
      {},
    );

    expect(first.alerts).toEqual([
      { window: 'seven_day', level: 3, percent: 100, resetsAt: null },
    ]);
    expect(
      evaluateLimits(
        limits({}, { status: 'rejected', rateLimitType: 'seven_day' }),
        first.state,
      ).alerts,
    ).toEqual([]);
  });
});

describe('formatAlert', () => {
  it('names the token and worker, the window, the percent and the reset', () => {
    const text = formatAlert(
      {
        window: 'seven_day',
        level: 1,
        percent: 82,
        resetsAt: sec('2026-10-19T23:00:00Z'),
      },
      'токен «entools» · worker pi-blue',
      NOW,
    );

    expect(text).toBe(
      '⚠️ Claude · токен «entools» · worker pi-blue: неделя 82% — лимит подходит к концу, сброс через 3 дн 11 ч',
    );
  });

  it('says plainly when the limit is used up', () => {
    const text = formatAlert(
      {
        window: 'five_hour',
        level: 3,
        percent: 100,
        resetsAt: sec('2026-10-16T14:30:00Z'),
      },
      'worker pi-green',
      NOW,
    );

    expect(text).toContain('⛔');
    expect(text).toContain('5 часов — лимит исчерпан');
    expect(text).toContain('сброс через 2 ч 30 мин');
    expect(text).not.toContain('100%');
  });

  it('copes with an unknown reset and an unknown window name', () => {
    expect(
      formatAlert(
        { window: 'thirty_day', level: 2, percent: 96, resetsAt: null },
        'x',
        NOW,
      ),
    ).toBe('🔴 Claude · x: thirty day 96% — почти исчерпан');
  });
});

describe('formatResetIn', () => {
  it('is coarse', () => {
    expect(formatResetIn(sec('2026-10-16T12:10:00Z'), NOW)).toBe(
      'через 10 мин',
    );
    expect(formatResetIn(sec('2026-10-16T16:00:00Z'), NOW)).toBe('через 4 ч');
    expect(formatResetIn(sec('2026-10-10T00:00:00Z'), NOW)).toBe('через 1 мин');
  });
});
