import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorkerJob } from '../../store/api';
import { JobList } from './JobList';

vi.mock('./CancelJobButton', () => ({ CancelJobButton: () => null }));
vi.mock('./RetryJobButton', () => ({ RetryJobButton: () => null }));

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

describe('JobList task filter', () => {
  const mk = (id: number, taskKey: string | null, status = 'succeeded') =>
    ({ ...job, id, taskKey, status }) as unknown as WorkerJob;
  const jobs = [
    mk(1, '173:628', 'failed'),
    mk(2, '173:628'),
    mk(3, 'file:9'),
    mk(4, null),
  ];

  it('shows the task key, file uploads as «файл #id», and nothing for null', () => {
    renderList({ jobs });
    expect(screen.getAllByRole('button', { name: '173:628' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'файл #9' })).toBeInTheDocument();
    expect(screen.getByText('Задача #4')).toBeInTheDocument();
  });

  it('filters to one task without opening the job, and clears', () => {
    const onOpenJob = vi.fn();
    render(<JobList jobs={jobs} isLoading={false} onOpenJob={onOpenJob} />);
    fireEvent.click(screen.getAllByRole('button', { name: '173:628' })[0]);
    expect(onOpenJob).not.toHaveBeenCalled();
    expect(screen.getByText('Задача #1')).toBeInTheDocument();
    expect(screen.getByText('Задача #2')).toBeInTheDocument();
    expect(screen.queryByText('Задача #3')).not.toBeInTheDocument();
    expect(screen.getByText('Задача: 173:628')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтр по задаче' }));
    expect(screen.getByText('Задача #3')).toBeInTheDocument();
    expect(screen.getByText('Задача #4')).toBeInTheDocument();
  });

  it('combines the task filter with the failed filter', () => {
    renderList({ jobs });
    fireEvent.click(screen.getAllByRole('button', { name: '173:628' })[0]);
    fireEvent.click(screen.getByText(/С ошибкой/));
    expect(screen.getByText('Задача #1')).toBeInTheDocument();
    expect(screen.queryByText('Задача #2')).not.toBeInTheDocument();
  });
});
