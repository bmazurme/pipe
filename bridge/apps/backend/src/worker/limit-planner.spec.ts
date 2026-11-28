import type { ClaudeLimits } from './claude-limits';
import {
  clock,
  isClaudeModel,
  planJob,
  resetAfterFailure,
  windowsOf,
} from './limit-planner';

const NOW = new Date('2026-11-28T12:00:00Z');
const sec = (minutesFromNow: number) =>
  Math.round(NOW.getTime() / 1000) + minutesFromNow * 60;

function limits(
  windows: Record<string, [number, number | null]>,
  over: Partial<ClaudeLimits> = {},
): ClaudeLimits {
  return {
    status: 'allowed',
    rateLimitType: null,
    isUsingOverage: false,
    windows: Object.fromEntries(
      Object.entries(windows).map(([name, [utilization, resetsAt]]) => [
        name,
        { utilization, resetsAt },
      ]),
    ),
    reportedAt: new Date(NOW.getTime() - 60_000).toISOString(),
    ...over,
  };
}

const token = (id: number, l: ClaudeLimits | null, authFailed = false) => ({
  id,
  limits: l,
  authFailed,
});

describe('windowsOf', () => {
  it('is the shared windows plus the model’s own week', () => {
    expect(windowsOf('opus')).toEqual([
      'five_hour',
      'seven_day',
      'seven_day_opus',
    ]);
    expect(windowsOf('sonnet')).toEqual([
      'five_hour',
      'seven_day',
      'seven_day_sonnet',
    ]);
    expect(windowsOf('haiku')).toEqual(['five_hour', 'seven_day']);
    expect(isClaudeModel('gpt')).toBe(false);
  });
});

describe('planJob — nothing in the way', () => {
  it('runs a job of another provider, a job with no tokens and a job with no report', () => {
    expect(
      planJob({
        model: 'gpt',
        urgency: 'deferrable',
        tokens: [token(1, limits({ five_hour: [1, sec(60)] }))],
        now: NOW,
      }),
    ).toEqual({ action: 'run' });
    expect(
      planJob({ model: 'sonnet', urgency: 'deferrable', tokens: [], now: NOW }),
    ).toEqual({ action: 'run' });
    expect(
      planJob({
        model: 'sonnet',
        urgency: 'deferrable',
        tokens: [token(1, null)],
        now: NOW,
      }),
    ).toEqual({ action: 'run' });
  });

  it('runs when every window has room', () => {
    expect(
      planJob({
        model: 'sonnet',
        urgency: 'deferrable',
        tokens: [
          token(
            1,
            limits({ five_hour: [0.5, sec(60)], seven_day: [0.4, sec(3000)] }),
          ),
        ],
        now: NOW,
      }),
    ).toEqual({ action: 'run' });
  });

  it('ignores a window that has already reset, and another model’s own week', () => {
    expect(
      planJob({
        model: 'sonnet',
        urgency: 'deferrable',
        tokens: [
          token(
            1,
            limits({
              five_hour: [0.99, sec(-5)],
              seven_day_opus: [1, sec(600)],
            }),
          ),
        ],
        now: NOW,
      }),
    ).toEqual({ action: 'run' });
  });
});

describe('planJob — a deferrable job', () => {
  it('holds off at the reserve, until the window resets (and a minute past)', () => {
    const plan = planJob({
      model: 'sonnet',
      urgency: 'deferrable',
      tokens: [token(1, limits({ five_hour: [0.92, sec(90)] }))],
      now: NOW,
    });

    expect(plan).toMatchObject({ action: 'defer' });
    expect((plan as { until: Date }).until.getTime()).toBe(
      (sec(90) + 60) * 1000,
    );
    expect((plan as { reason: string }).reason).toBe(
      'Claude · 5 часов 92% — несрочная задача отложена до сброса лимита',
    );
  });

  it('waits for the window that frees up last when several are over', () => {
    const plan = planJob({
      model: 'opus',
      urgency: 'deferrable',
      tokens: [
        token(
          1,
          limits({
            five_hour: [0.95, sec(60)],
            seven_day_opus: [1, sec(2000)],
          }),
        ),
      ],
      now: NOW,
    });

    expect((plan as { until: Date }).until.getTime()).toBe(
      (sec(2000) + 60) * 1000,
    );
    expect((plan as { reason: string }).reason).toContain('неделя · Opus');
  });

  it('goes to another token that has room, rather than waiting', () => {
    expect(
      planJob({
        model: 'sonnet',
        urgency: 'deferrable',
        tokens: [
          token(1, limits({ five_hour: [1, sec(60)] })),
          token(2, limits({ five_hour: [0.1, sec(200)] })),
        ],
        now: NOW,
      }),
    ).toMatchObject({ action: 'switch', credentialId: 2 });
  });

  it('waits only until the first token frees up when all are held', () => {
    const plan = planJob({
      model: 'sonnet',
      urgency: 'deferrable',
      tokens: [
        token(1, limits({ five_hour: [1, sec(240)] })),
        token(2, limits({ five_hour: [1, sec(100)] })),
      ],
      now: NOW,
    });

    expect((plan as { until: Date }).until.getTime()).toBe(
      (sec(100) + 60) * 1000,
    );
  });

  it('never swaps a token the owner chose — it waits for that one', () => {
    const tokens = [
      token(1, limits({ five_hour: [1, sec(60)] })),
      token(2, limits({ five_hour: [0.1, sec(200)] })),
    ];

    expect(
      planJob({
        model: 'sonnet',
        urgency: 'deferrable',
        pinnedCredentialId: 1,
        tokens,
        now: NOW,
      }),
    ).toMatchObject({ action: 'defer' });
    expect(
      planJob({
        model: 'sonnet',
        urgency: 'deferrable',
        pinnedCredentialId: 2,
        tokens,
        now: NOW,
      }),
    ).toEqual({ action: 'run' });
  });

  it('counts a report with no reset time for half an hour only', () => {
    const undated = limits({ five_hour: [0.95, null] });

    expect(
      planJob({
        model: 'haiku',
        urgency: 'deferrable',
        tokens: [token(1, undated)],
        now: NOW,
      }),
    ).toMatchObject({ action: 'defer' });
    expect(
      planJob({
        model: 'haiku',
        urgency: 'deferrable',
        tokens: [token(1, undated)],
        now: new Date(NOW.getTime() + 40 * 60_000),
      }),
    ).toEqual({ action: 'run' });
  });
});

describe('planJob — the token a job would take', () => {
  it('tries the preferred token first, and keeps the job on it when it has room', () => {
    const tokens = [
      token(1, null),
      token(2, limits({ five_hour: [0.1, sec(60)] })),
    ];

    expect(
      planJob({
        model: 'sonnet',
        urgency: 'deferrable',
        preferredCredentialId: 2,
        tokens,
        now: NOW,
      }),
    ).toEqual({ action: 'run' });
  });

  it('moves a job off its preferred token when that one is held and another has room', () => {
    const tokens = [
      token(1, null),
      token(2, limits({ five_hour: [1, sec(60)] })),
    ];

    expect(
      planJob({
        model: 'sonnet',
        urgency: 'deferrable',
        preferredCredentialId: 2,
        tokens,
        now: NOW,
      }),
    ).toMatchObject({
      action: 'switch',
      credentialId: 1,
    });
  });
});

describe('planJob — an urgent job', () => {
  it('runs at the reserve (it is what the reserve is for)', () => {
    expect(
      planJob({
        model: 'sonnet',
        urgency: 'urgent',
        tokens: [token(1, limits({ five_hour: [0.95, sec(60)] }))],
        now: NOW,
      }),
    ).toEqual({ action: 'run' });
  });

  it('moves to a token with room when its own is used up', () => {
    expect(
      planJob({
        model: 'sonnet',
        urgency: 'urgent',
        tokens: [
          token(1, limits({ seven_day: [1, sec(5000)] })),
          token(2, null),
        ],
        now: NOW,
      }),
    ).toMatchObject({ action: 'switch', credentialId: 2 });
  });

  it('treats the CLI’s "rejected" as used up even when the window shows less', () => {
    expect(
      planJob({
        model: 'sonnet',
        urgency: 'urgent',
        tokens: [
          token(
            1,
            limits(
              { five_hour: [0.7, sec(60)] },
              { status: 'rejected', rateLimitType: 'five_hour' },
            ),
          ),
          token(2, null),
        ],
        now: NOW,
      }),
    ).toMatchObject({ action: 'switch', credentialId: 2 });
  });

  it('runs anyway when nothing has room, says so, and names a model that does — without swapping it', () => {
    const plan = planJob({
      model: 'opus',
      urgency: 'urgent',
      tokens: [
        token(
          1,
          limits({ five_hour: [0.3, sec(60)], seven_day_opus: [1, sec(2000)] }),
        ),
      ],
      now: NOW,
    });

    expect(plan).toEqual({
      action: 'run',
      warning: 'Claude · неделя · Opus 100% — задача может упасть на лимите',
      alternativeModel: 'haiku',
    });
  });

  it('has no alternative when every model is blocked', () => {
    const plan = planJob({
      model: 'opus',
      urgency: 'urgent',
      tokens: [token(1, limits({ five_hour: [1, sec(60)] }))],
      now: NOW,
    });

    expect(plan).toMatchObject({ action: 'run' });
    expect('alternativeModel' in plan).toBe(false);
  });

  it('prefers a token Anthropic has not refused', () => {
    expect(
      planJob({
        model: 'sonnet',
        urgency: 'urgent',
        tokens: [
          token(1, limits({ five_hour: [1, sec(60)] }), true),
          token(2, null),
        ],
        now: NOW,
      }),
    ).toEqual({ action: 'run' });
  });
});

describe('resetAfterFailure', () => {
  const rejected = (extra: Partial<ClaudeLimits> = {}) =>
    limits(
      { five_hour: [1, sec(100)] },
      { status: 'rejected', rateLimitType: 'five_hour', ...extra },
    );

  it('is when the window that ran out resets, a minute past', () => {
    expect(resetAfterFailure(rejected(), NOW)?.getTime()).toBe(
      (sec(100) + 60) * 1000,
    );
  });

  it('reads the window from the over-used ones when the verdict names none', () => {
    expect(
      resetAfterFailure(rejected({ rateLimitType: null }), NOW)?.getTime(),
    ).toBe((sec(100) + 60) * 1000);
  });

  it('is nothing for a failure that was not a limit, an old report, or a window with no reset time', () => {
    expect(resetAfterFailure(null, NOW)).toBeNull();
    expect(
      resetAfterFailure(limits({ five_hour: [1, sec(100)] }), NOW),
    ).toBeNull();
    expect(
      resetAfterFailure(
        rejected({
          reportedAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
        }),
        NOW,
      ),
    ).toBeNull();
    expect(
      resetAfterFailure(
        limits(
          { five_hour: [1, null] },
          { status: 'rejected', rateLimitType: 'five_hour' },
        ),
        NOW,
      ),
    ).toBeNull();
    expect(
      resetAfterFailure(
        rejected({
          windows: { five_hour: { utilization: 1, resetsAt: sec(-1) } },
        }),
        NOW,
      ),
    ).toBeNull();
  });
});

describe('clock', () => {
  it('is the time today and the date with the time otherwise', () => {
    const now = new Date(2026, 10, 28, 12, 0);

    expect(clock(new Date(2026, 10, 28, 15, 4), now)).toBe('15:04');
    expect(clock(new Date(2026, 10, 30, 9, 5), now)).toBe('30.11 09:05');
  });
});
