import {
  decideEscalation,
  DEFAULT_ESCALATION,
  describeSkip,
  escalationFromSettings,
  escalationNote,
  isTaskFailure,
  nextModel,
  usd,
} from './escalation';

const on = { ...DEFAULT_ESCALATION, enabled: true };
const base = {
  settings: on,
  model: 'haiku',
  alreadyEscalated: false,
  taskSpentUsd: 0,
  daySpentUsd: 0,
};

describe('nextModel', () => {
  it('goes one step up the Claude ladder and stops at the top', () => {
    expect(nextModel('haiku')).toBe('sonnet');
    expect(nextModel('sonnet')).toBe('opus');
    expect(nextModel('opus')).toBeNull();
  });

  it('has no step for anything off the ladder', () => {
    expect(nextModel('gpt-5')).toBeNull();
    expect(nextModel('auto')).toBeNull();
    expect(nextModel('deepseek')).toBeNull();
    expect(nextModel('')).toBeNull();
  });
});

describe('decideEscalation', () => {
  it('is off by default', () => {
    expect(decideEscalation({ ...base, settings: DEFAULT_ESCALATION })).toEqual(
      { action: 'skip', reason: 'off' },
    );
  });

  it('goes up one step when on', () => {
    expect(decideEscalation(base)).toEqual({
      action: 'escalate',
      to: 'sonnet',
    });
    expect(decideEscalation({ ...base, model: 'sonnet' })).toEqual({
      action: 'escalate',
      to: 'opus',
    });
  });

  it('does nothing at the top or off the ladder', () => {
    expect(decideEscalation({ ...base, model: 'opus' })).toEqual({
      action: 'skip',
      reason: 'no-next-model',
    });
    expect(decideEscalation({ ...base, model: 'gpt-5' })).toEqual({
      action: 'skip',
      reason: 'no-next-model',
    });
  });

  it('goes up only once', () => {
    expect(
      decideEscalation({ ...base, model: 'sonnet', alreadyEscalated: true }),
    ).toEqual({ action: 'skip', reason: 'already-escalated' });
  });

  it('refuses at the task cap, and at the day cap', () => {
    expect(decideEscalation({ ...base, taskSpentUsd: 5 })).toEqual({
      action: 'skip',
      reason: 'task-cap',
    });
    expect(decideEscalation({ ...base, taskSpentUsd: 4.99 })).toEqual({
      action: 'escalate',
      to: 'sonnet',
    });
    expect(decideEscalation({ ...base, daySpentUsd: 20 })).toEqual({
      action: 'skip',
      reason: 'day-cap',
    });
  });

  it('a cap of zero refuses every escalation', () => {
    expect(
      decideEscalation({ ...base, settings: { ...on, capDayUsd: 0 } }),
    ).toEqual({ action: 'skip', reason: 'day-cap' });
  });
});

describe('escalationFromSettings', () => {
  it('uses the defaults for an account that never saved any', () => {
    expect(escalationFromSettings(null)).toEqual(DEFAULT_ESCALATION);
    expect(escalationFromSettings({})).toEqual(DEFAULT_ESCALATION);
  });

  it('reads what was saved, a zero included', () => {
    expect(
      escalationFromSettings({
        escalateOnFailure: true,
        escalationCapTaskUsd: 0,
        escalationCapDayUsd: 7.5,
      }),
    ).toEqual({ enabled: true, capTaskUsd: 0, capDayUsd: 7.5 });
  });
});

describe('words', () => {
  it('says why it did not escalate, with the numbers', () => {
    expect(describeSkip('task-cap', on)).toContain('$5.00');
    expect(describeSkip('day-cap', on)).toContain('$20.00');
    expect(describeSkip('off', on)).toContain('выключена');
  });

  it('notes the step on the new run', () => {
    expect(escalationNote('haiku', 'sonnet', 'failed')).toContain('haiku');
    expect(escalationNote('haiku', 'sonnet', 'ci')).toContain('CI');
    expect(usd(12)).toBe('$12.00');
  });
});

describe('isTaskFailure', () => {
  it('is a failure of the task when the model ran and did not get there', () => {
    expect(
      isTaskFailure({
        errorMessage:
          'claude exited with code 1: could not make the tests pass',
      }),
    ).toBe(true);
    expect(isTaskFailure({ errorMessage: null })).toBe(true);
  });

  it('is not one when the worker went away or the provider had a bad moment', () => {
    expect(isTaskFailure({ errorMessage: 'x', failureKind: 'lost' })).toBe(
      false,
    );
    expect(
      isTaskFailure({
        errorMessage: 'API Error: 529 {"type":"overloaded_error"}',
      }),
    ).toBe(false);
  });

  it('is not one when the account was refused or ran out: a stronger model meets the same wall', () => {
    expect(
      isTaskFailure({ errorMessage: 'Failed to authenticate. API Error: 401' }),
    ).toBe(false);
    expect(isTaskFailure({ errorMessage: 'Claude usage limit reached' })).toBe(
      false,
    );
  });
});
