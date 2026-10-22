import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FailureBreakdown } from './FailureBreakdown';

const useQuery = vi.fn();

vi.mock('../../store/api', () => ({
  useGetFailureSummaryQuery: (...args: unknown[]) => useQuery(...args),
}));

const view = (onOpenJob = vi.fn()) =>
  render(
    <ThemeProvider theme="light">
      <FailureBreakdown onOpenJob={onOpenJob} />
    </ThemeProvider>,
  );

describe('FailureBreakdown', () => {
  beforeEach(() => useQuery.mockReset());

  it('shows the success rate and groups, and opens the last job of a group', () => {
    useQuery.mockReturnValue({
      data: {
        total: 10,
        failed: 3,
        groups: [
          { message: 'claude timed out after Ns', count: 2, lastJobId: 42, infra: false },
          { message: 'Worker was stopped (SIGTERM)', count: 1, lastJobId: 7, infra: true },
        ],
      },
    });
    const onOpenJob = vi.fn();
    view(onOpenJob);

    expect(screen.getByText('Успешно: 70%')).toBeTruthy();
    expect(screen.getByText('claude timed out after Ns')).toBeTruthy();
    expect(screen.getAllByText('инфраструктура')).toHaveLength(1);

    fireEvent.click(screen.getAllByText('Открыть последнюю')[0]);
    expect(onOpenJob).toHaveBeenCalledWith(42);
  });

  it('renders nothing when no job failed', () => {
    useQuery.mockReturnValue({ data: { total: 4, failed: 0, groups: [] } });
    const { container } = view();

    expect(container.textContent).toBe('');
  });
});
