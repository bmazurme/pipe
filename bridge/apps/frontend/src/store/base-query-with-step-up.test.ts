import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import baseQueryMock from './base-query';

vi.mock('./base-query', () => ({ default: vi.fn() }));

import baseQueryWithStepUp from './base-query-with-step-up';
import {
  currentStepUpGrant,
  setStepUpPrompt,
  storeStepUpGrant,
} from './step-up';

const REQUIRED = { error: { status: 403, data: { code: 'STEP_UP_REQUIRED' } } };
const api = {} as never;

beforeEach(() => vi.mocked(baseQueryMock).mockReset());
afterEach(() => setStepUpPrompt(null));

describe('baseQueryWithStepUp', () => {
  it('passes an ordinary answer straight through, without asking', async () => {
    const prompt = vi.fn();

    setStepUpPrompt(prompt);
    vi.mocked(baseQueryMock).mockResolvedValue({ data: 'ok' });

    await expect(baseQueryWithStepUp('secrets', api, {})).resolves.toEqual({ data: 'ok' });
    expect(prompt).not.toHaveBeenCalled();
  });

  it('does not treat another 403 as a request for a code', async () => {
    const prompt = vi.fn();
    const forbidden = { error: { status: 403, data: { message: 'Limited to the deployment owner' } } };

    setStepUpPrompt(prompt);
    vi.mocked(baseQueryMock).mockResolvedValue(forbidden);

    await expect(baseQueryWithStepUp('vpn', api, {})).resolves.toEqual(forbidden);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('asks for a code and sends the same request again once it is given', async () => {
    setStepUpPrompt(async () => true);
    vi.mocked(baseQueryMock).mockResolvedValueOnce(REQUIRED).mockResolvedValueOnce({ data: { value: 'x' } });

    await expect(baseQueryWithStepUp('secrets/5/value', api, {})).resolves.toEqual({ data: { value: 'x' } });
    expect(baseQueryMock).toHaveBeenCalledTimes(2);
    expect(vi.mocked(baseQueryMock).mock.calls[1][0]).toBe('secrets/5/value');
  });

  it('gives the 403 back when the person closes the dialog, and does not retry', async () => {
    setStepUpPrompt(async () => false);
    vi.mocked(baseQueryMock).mockResolvedValue(REQUIRED);

    await expect(baseQueryWithStepUp('secrets/5/value', api, {})).resolves.toEqual(REQUIRED);
    expect(baseQueryMock).toHaveBeenCalledTimes(1);
  });

  it('drops a grant the server refused before asking again', async () => {
    storeStepUpGrant('stale', new Date(Date.now() + 60_000).toISOString());
    setStepUpPrompt(async () => false);
    vi.mocked(baseQueryMock).mockResolvedValue(REQUIRED);

    await baseQueryWithStepUp('secrets/5/value', api, {});

    expect(currentStepUpGrant()).toBeNull();
  });

  it('answers the 403 as it is when no dialog is mounted (login page, tests)', async () => {
    vi.mocked(baseQueryMock).mockResolvedValue(REQUIRED);

    await expect(baseQueryWithStepUp('secrets/5/value', api, {})).resolves.toEqual(REQUIRED);
  });
});
