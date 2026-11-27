import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearStepUpGrant,
  currentStepUpGrant,
  isStepUpRequired,
  requestStepUp,
  setStepUpPrompt,
  storeStepUpGrant,
} from './step-up';

afterEach(() => {
  clearStepUpGrant();
  setStepUpPrompt(null);
});

describe('step-up grant', () => {
  it('hands out a stored grant until shortly before it expires', () => {
    const now = Date.parse('2026-11-27T12:00:00Z');

    storeStepUpGrant('tok', '2026-11-27T12:05:00Z');

    expect(currentStepUpGrant(now)).toBe('tok');
    // under five seconds left: not worth sending, and forgotten
    expect(currentStepUpGrant(Date.parse('2026-11-27T12:04:57Z'))).toBeNull();
    expect(currentStepUpGrant(now)).toBeNull();
  });

  it('forgets a grant on demand', () => {
    storeStepUpGrant('tok', new Date(Date.now() + 60_000).toISOString());
    clearStepUpGrant();

    expect(currentStepUpGrant()).toBeNull();
  });
});

describe('requestStepUp', () => {
  it('answers false when no dialog is registered', async () => {
    await expect(requestStepUp()).resolves.toBe(false);
  });

  it('shares one question between requests that need a code at the same time', async () => {
    let answer: (granted: boolean) => void = () => undefined;
    const prompt = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));

    setStepUpPrompt(prompt);

    const first = requestStepUp();
    const second = requestStepUp();

    answer(true);

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(prompt).toHaveBeenCalledTimes(1);

    // and a later need asks afresh
    prompt.mockResolvedValueOnce(false);
    await expect(requestStepUp()).resolves.toBe(false);
    expect(prompt).toHaveBeenCalledTimes(2);
  });
});

describe('isStepUpRequired', () => {
  it('recognises only the 403 with that code', () => {
    expect(isStepUpRequired({ status: 403, data: { code: 'STEP_UP_REQUIRED' } })).toBe(true);
    expect(isStepUpRequired({ status: 403, data: { code: 'STEP_UP_INVALID_CODE' } })).toBe(false);
    expect(isStepUpRequired({ status: 403, data: { message: 'Limited to the deployment owner' } })).toBe(false);
    expect(isStepUpRequired({ status: 401, data: { code: 'STEP_UP_REQUIRED' } })).toBe(false);
    expect(isStepUpRequired(undefined)).toBe(false);
    expect(isStepUpRequired('x')).toBe(false);
  });
});
