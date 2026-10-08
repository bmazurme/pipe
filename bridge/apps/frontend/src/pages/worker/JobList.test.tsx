import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorkerJob } from '../../store/api';
import { JobList } from './JobList';

vi.mock('./CancelJobButton', () => ({ CancelJobButton: () => null }));

const job = {
  id: 7,
  model: 'sonnet',
  status: 'succeeded',
  createdAt: new Date().toISOString(),
} as unknown as WorkerJob;

const renderList = (props: {
  jobs?: WorkerJob[];
  isLoading?: boolean;
  isError?: boolean;
}) =>
  render(
    <JobList
      jobs={props.jobs ?? []}
      isLoading={props.isLoading ?? false}
      isError={props.isError}
      onOpenJob={() => {}}
    />,
  );

describe('JobList', () => {
  it('shows a loader, not the empty state, during the first fetch', () => {
    renderList({ isLoading: true });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Задач ещё нет')).not.toBeInTheDocument();
  });

  it('shows an error alert instead of the empty state when the fetch fails', () => {
    renderList({ isError: true });
    expect(screen.getByText('Не удалось загрузить задачи')).toBeInTheDocument();
    expect(screen.queryByText('Задач ещё нет')).not.toBeInTheDocument();
  });

  it('shows the empty state when the fetch succeeded with no jobs', () => {
    renderList({});
    expect(screen.getByText('Задач ещё нет')).toBeInTheDocument();
  });

  it('keeps the list visible when a poll fails but jobs are cached', () => {
    renderList({ jobs: [job], isError: true });
    expect(screen.getByText('Задача #7')).toBeInTheDocument();
    expect(
      screen.queryByText('Не удалось загрузить задачи'),
    ).not.toBeInTheDocument();
  });
});
