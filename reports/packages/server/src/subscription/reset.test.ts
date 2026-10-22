import { beforeEach, describe, expect, it, vi } from 'vitest';

const getIssueState = vi.fn();
const setIssueState = vi.fn();
const currentBranch = vi.fn();
const stashChanges = vi.fn();

vi.mock('./state-props', () => ({ getIssueState: (...args: unknown[]) => getIssueState(...args), setIssueState: (...args: unknown[]) => setIssueState(...args) }));
vi.mock('./git', () => ({ currentBranch: (...args: unknown[]) => currentBranch(...args), stashChanges: (...args: unknown[]) => stashChanges(...args) }));
vi.mock('./work-tree', () => ({ workTreeFor: () => ({ path: '/repo', baseBranch: 'main' }) }));

import { resetSubscriptionIssue } from './reset';

const pulled = { step: 'pulled', branch: 'me-22.10.2026-5', pushedAt: 'a', pulledAt: 'b', pulledFiles: 3, parcelId: 9, encrypted: true };

beforeEach(() => {
  vi.clearAllMocks();
  getIssueState.mockReturnValue(pulled);
  setIssueState.mockImplementation((_p: string, _i: string, patch: object) => ({ ...pulled, ...patch }));
  currentBranch.mockResolvedValue('me-22.10.2026-5');
  stashChanges.mockResolvedValue(true);
});

describe('resetSubscriptionIssue', () => {
  it('takes the task back to init and forgets what happened since, keeping its branch', async () => {
    const result = await resetSubscriptionIssue('7', '5');

    expect(setIssueState).toHaveBeenCalledWith('7', '5', {
      step: 'init',
      pushedAt: undefined,
      pulledAt: undefined,
      publishedAt: undefined,
      pulledFiles: undefined,
      parcelId: undefined,
      encrypted: undefined,
    });
    expect(result.state.step).toBe('init');
    expect(result.state.branch).toBe('me-22.10.2026-5');
    expect(result.stashed).toBe(false);
    expect(stashChanges).not.toHaveBeenCalled();
  });

  it('puts the files of the result into the stash, not into the bin, when asked', async () => {
    const result = await resetSubscriptionIssue('7', '5', { discardFiles: true });

    expect(stashChanges).toHaveBeenCalledWith('/repo', expect.stringContaining('сброс прогресса'));
    expect(result.stashed).toBe(true);
  });

  it('leaves alone a repository that is on some other branch (someone else’s work)', async () => {
    currentBranch.mockResolvedValue('main');

    const result = await resetSubscriptionIssue('7', '5', { discardFiles: true });

    expect(stashChanges).not.toHaveBeenCalled();
    expect(result.stashed).toBe(false);
    expect(result.state.step).toBe('init');
  });

  it('can reset a published task too, and says nothing was stashed when the tree was clean', async () => {
    getIssueState.mockReturnValue({ ...pulled, step: 'published', publishedAt: 'c' });
    stashChanges.mockResolvedValue(false);

    expect((await resetSubscriptionIssue('7', '5', { discardFiles: true })).stashed).toBe(false);
  });

  it('refuses a task that has no progress or has not received its result yet', async () => {
    getIssueState.mockReturnValue(undefined);
    await expect(resetSubscriptionIssue('7', '5')).rejects.toThrow('сбрасывать нечего');

    getIssueState.mockReturnValue({ step: 'pushed' });
    await expect(resetSubscriptionIssue('7', '5')).rejects.toThrow('после получения результата');
    getIssueState.mockReturnValue({ step: 'init' });
    await expect(resetSubscriptionIssue('7', '5')).rejects.toThrow('после получения результата');
    expect(setIssueState).not.toHaveBeenCalled();
  });
});
