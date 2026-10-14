import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@gravity-ui/uikit';

import { EnrollInstructions } from './EnrollInstructions';

const listWorkers = vi.fn();

vi.mock('../../store/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/api')>()),
  useListWorkersQuery: (...args: unknown[]) => listWorkers(...args),
  useRenewWorkerEnrollmentMutation: () => [vi.fn(), { isLoading: false }],
}));

function renderIt() {
  return render(
    <ThemeProvider theme="light">
      <EnrollInstructions
        workerId={1}
        workerName="green"
        code="brn_x"
        expiresAt={new Date(Date.now() + 600_000).toISOString()}
        onRenewed={() => undefined}
      />
    </ThemeProvider>,
  );
}

const lastOptions = () => listWorkers.mock.calls.at(-1)?.[1] as { pollingInterval: number; skipPollingIfUnfocused: boolean };

describe('EnrollInstructions polling', () => {
  beforeEach(() => listWorkers.mockReset());

  it('polls while the worker is pending, only when focused', () => {
    listWorkers.mockReturnValue({ data: [{ id: 1, state: 'pending' }] });
    renderIt();

    expect(lastOptions().pollingInterval).toBe(3000);
    expect(lastOptions().skipPollingIfUnfocused).toBe(true);
  });

  it('stops polling once the worker leaves pending', () => {
    listWorkers.mockReturnValue({ data: [{ id: 1, state: 'idle' }] });
    renderIt();

    expect(screen.getByRole('status')).toBeTruthy();
    expect(lastOptions().pollingInterval).toBe(0);
  });
});
