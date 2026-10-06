import { describe, expect, it, vi } from 'vitest';

import { createAutopilot, type AutopilotDeps } from './autopilot';

function deps(overrides: Partial<AutopilotDeps> = {}): AutopilotDeps {
  return {
    hasBridge: () => true,
    heartbeat: vi.fn().mockResolvedValue(undefined),
    event: vi.fn().mockResolvedValue(undefined),
    pushedKeys: () => ['173:6'],
    resultReady: vi.fn().mockResolvedValue(true),
    pull: vi.fn().mockResolvedValue({ branch: 'task/173-6' }),
    now: () => 1_000_000,
    ...overrides,
  };
}

describe('autopilot', () => {
  it('pulls a pushed task whose result is ready and reports it', async () => {
    const d = deps();

    await createAutopilot(d, 'ctr').pullReady();

    expect(d.pull).toHaveBeenCalledWith('173', '6');
    expect(d.event).toHaveBeenCalledWith('ctr', { type: 'pulled', taskKey: '173:6', branch: 'task/173-6' });
  });

  it('leaves a task alone while no result is on bridge yet', async () => {
    const d = deps({ resultReady: vi.fn().mockResolvedValue(false) });

    await createAutopilot(d, 'ctr').pullReady();

    expect(d.pull).not.toHaveBeenCalled();
    expect(d.event).not.toHaveBeenCalled();
  });

  it('reports a failed pull once and does not retry it right away', async () => {
    let now = 1_000_000;
    const d = deps({ pull: vi.fn().mockRejectedValue(new Error('dirty tree')), now: () => now });
    const autopilot = createAutopilot(d, 'ctr');

    await autopilot.pullReady();
    now += 30_000;
    await autopilot.pullReady();

    expect(d.pull).toHaveBeenCalledTimes(1);
    expect(d.event).toHaveBeenCalledWith('ctr', { type: 'pull_failed', taskKey: '173:6', error: 'dirty tree' });

    now += 11 * 60_000;
    await autopilot.pullReady();

    expect(d.pull).toHaveBeenCalledTimes(2);
  });

  it('does nothing until bridge is configured', async () => {
    const d = deps({ hasBridge: () => false });
    const autopilot = createAutopilot(d, 'ctr');

    await autopilot.beat();
    await autopilot.pullReady();

    expect(d.heartbeat).not.toHaveBeenCalled();
    expect(d.pull).not.toHaveBeenCalled();
  });

  it('swallows a failing heartbeat so the timer keeps running', async () => {
    const d = deps({ heartbeat: vi.fn().mockRejectedValue(new Error('offline')) });

    await expect(createAutopilot(d, 'ctr').beat()).resolves.toBeUndefined();
  });

  it('never runs two pull passes at once', async () => {
    let release: () => void = () => undefined;
    const d = deps({ pull: vi.fn(() => new Promise<{ branch?: string }>((r) => { release = () => r({}); })) });
    const autopilot = createAutopilot(d, 'ctr');

    const first = autopilot.pullReady();
    await autopilot.pullReady();
    release();
    await first;

    expect(d.pull).toHaveBeenCalledTimes(1);
  });
});
