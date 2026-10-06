import { LoopStage } from './entities/loop-run.entity';
import { interpretGithubEvent, parseRunIdFromBranch } from './github-events';

const workflows = { ci: 'CI', deploy: 'Deploy bridge' };

function pr(action: string, merged = false, ref = 'loop/run-12-fix-x') {
  return {
    action,
    pull_request: { number: 5, title: 'Fix x', merged, head: { ref } },
  };
}

describe('parseRunIdFromBranch', () => {
  it('extracts the run id from a loop branch', () => {
    expect(parseRunIdFromBranch('loop/run-12-fix-x')).toBe(12);
    expect(parseRunIdFromBranch('loop/run-7')).toBe(7);
  });

  it('returns undefined for any other branch', () => {
    expect(parseRunIdFromBranch('main')).toBeUndefined();
    expect(parseRunIdFromBranch('loop/run-abc')).toBeUndefined();
    expect(parseRunIdFromBranch(undefined)).toBeUndefined();
  });
});

describe('interpretGithubEvent', () => {
  it('ignores event types the loop does not track', () => {
    expect(interpretGithubEvent('push', {}, workflows)).toBeNull();
  });

  it('ignores pull requests outside loop branches', () => {
    expect(
      interpretGithubEvent(
        'pull_request',
        pr('opened', false, 'feature/x'),
        workflows,
      ),
    ).toBeNull();
  });

  it('moves an opened loop PR to pr_open and correlates by branch', () => {
    expect(
      interpretGithubEvent('pull_request', pr('opened'), workflows),
    ).toMatchObject({ runId: 12, prNumber: 5, stage: LoopStage.PrOpen });
  });

  it('moves a merged PR to deploying', () => {
    expect(
      interpretGithubEvent('pull_request', pr('closed', true), workflows),
    ).toMatchObject({ stage: LoopStage.Deploying });
  });

  it('fails a PR closed without merge', () => {
    expect(
      interpretGithubEvent('pull_request', pr('closed'), workflows),
    ).toMatchObject({
      stage: LoopStage.Failed,
      error: 'PR closed without merge',
    });
  });

  it('ignores other PR actions such as synchronize', () => {
    expect(
      interpretGithubEvent('pull_request', pr('synchronize'), workflows),
    ).toBeNull();
  });

  const run = (
    name: string,
    conclusion: string,
    head_branch = 'loop/run-12-a',
  ) => ({
    action: 'completed',
    workflow_run: {
      name,
      conclusion,
      head_branch,
      pull_requests: [{ number: 5 }],
    },
  });

  it('reports green CI and clears the error', () => {
    expect(
      interpretGithubEvent('workflow_run', run('CI', 'success'), workflows),
    ).toMatchObject({
      runId: 12,
      prNumber: 5,
      stage: LoopStage.Ci,
      error: null,
    });
  });

  it('records a red CI on the run', () => {
    expect(
      interpretGithubEvent('workflow_run', run('CI', 'failure'), workflows),
    ).toMatchObject({ stage: LoopStage.Ci, error: 'CI failure' });
  });

  it('finishes the run on a green deploy and fails it on a red one', () => {
    const ok = interpretGithubEvent(
      'workflow_run',
      run('Deploy bridge', 'success', 'main'),
      workflows,
    );
    const bad = interpretGithubEvent(
      'workflow_run',
      run('Deploy bridge', 'failure', 'main'),
      workflows,
    );

    expect(ok).toMatchObject({
      stage: LoopStage.Done,
      matchDeploying: true,
      notifyUnmatched: true,
    });
    expect(bad).toMatchObject({
      stage: LoopStage.Failed,
      error: 'Deploy failure',
    });
  });

  it('ignores unfinished and unrelated workflow runs', () => {
    expect(
      interpretGithubEvent(
        'workflow_run',
        { action: 'requested', workflow_run: { name: 'CI' } },
        workflows,
      ),
    ).toBeNull();
    expect(
      interpretGithubEvent(
        'workflow_run',
        run('Nightly', 'success'),
        workflows,
      ),
    ).toBeNull();
  });

  describe('loop PRs identified by label', () => {
    const labeledPr = (action: string, extra: object = {}) => ({
      action,
      ...extra,
      pull_request: {
        number: 9,
        title: 'Fix docs',
        merged: false,
        head: { ref: 'me-06.10.2026-9' },
        labels: [{ name: 'loop' }],
      },
    });

    it('treats the first `loop` label on an unlabeled PR as it opening', () => {
      const result = interpretGithubEvent(
        'pull_request',
        {
          action: 'labeled',
          label: { name: 'loop' },
          pull_request: {
            number: 9,
            title: 'T',
            head: { ref: 'x' },
            labels: [],
          },
        },
        workflows,
      );

      expect(result).toMatchObject({
        stage: LoopStage.PrOpen,
        prNumber: 9,
        adopt: { title: 'T' },
      });
    });

    it('ignores other labels being added to an unrelated PR', () => {
      expect(
        interpretGithubEvent(
          'pull_request',
          {
            action: 'labeled',
            label: { name: 'bug' },
            pull_request: {
              number: 9,
              head: { ref: 'x' },
              labels: [{ name: 'bug' }],
            },
          },
          workflows,
        ),
      ).toBeNull();
    });

    it('follows a labeled PR through merge and close', () => {
      expect(
        interpretGithubEvent(
          'pull_request',
          labeledPr('closed', {}),
          workflows,
        ),
      ).toMatchObject({ stage: LoopStage.Failed });
      expect(
        interpretGithubEvent(
          'pull_request',
          {
            ...labeledPr('closed'),
            pull_request: { ...labeledPr('closed').pull_request, merged: true },
          },
          workflows,
        ),
      ).toMatchObject({ stage: LoopStage.Deploying });
    });
  });

  it('marks green CI for a merge offer, and red CI not', () => {
    const ci = (conclusion: string) =>
      interpretGithubEvent(
        'workflow_run',
        {
          action: 'completed',
          workflow_run: {
            name: 'CI',
            conclusion,
            head_branch: 'x',
            pull_requests: [{ number: 5 }],
          },
        },
        workflows,
      );

    expect(ci('success')).toMatchObject({ offerMerge: true, prNumber: 5 });
    expect(ci('failure')?.offerMerge).toBe(false);
  });
});
