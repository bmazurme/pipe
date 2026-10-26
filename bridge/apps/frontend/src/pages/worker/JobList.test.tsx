import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../../test/render';
import { WorkerJob } from '../../store/api';
import { JobList } from './JobList';

vi.mock('./CancelJobButton', () => ({ CancelJobButton: () => null }));
vi.mock('./ClearFinishedJobsButton', () => ({ ClearFinishedJobsButton: () => null }));
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
  renderWithTheme(
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
    renderWithTheme(<JobList jobs={jobs} isLoading={false} onOpenJob={onOpenJob} />);
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

describe('JobList search', () => {
  const mk = (id: number, over: Record<string, unknown>) =>
    ({ ...job, id, taskKey: null, ...over }) as unknown as WorkerJob;
  const jobs = [
    mk(11, { status: 'failed', errorMessage: 'OAuth token revoked' }),
    mk(12, { status: 'succeeded', errorMessage: 'OAuth token revoked earlier' }),
    mk(13, { status: 'failed', errorMessage: 'claude timed out' }),
    mk(14, { model: 'opus', taskKey: '173:628' }),
  ];
  const search = (value: string) =>
    fireEvent.change(screen.getByLabelText('Поиск по запускам'), { target: { value } });

  it('matches on the error message, ignoring case', () => {
    renderList({ jobs });
    search('oauth');
    expect(screen.getByText('Задача #11')).toBeInTheDocument();
    expect(screen.getByText('Задача #12')).toBeInTheDocument();
    expect(screen.queryByText('Задача #13')).not.toBeInTheDocument();
  });

  it('matches on the job id, the task key and the model', () => {
    renderList({ jobs });
    search('#13');
    expect(screen.getByText('Задача #13')).toBeInTheDocument();
    expect(screen.queryByText('Задача #11')).not.toBeInTheDocument();
    search('173:628');
    expect(screen.getByText('Задача #14')).toBeInTheDocument();
    search('opus');
    expect(screen.getByText('Задача #14')).toBeInTheDocument();
    expect(screen.queryByText('Задача #13')).not.toBeInTheDocument();
  });

  it('combines with the failed filter and restores the list when cleared', () => {
    renderList({ jobs });
    fireEvent.click(screen.getByText(/С ошибкой/));
    search('oauth');
    expect(screen.getByText('Задача #11')).toBeInTheDocument();
    expect(screen.queryByText('Задача #12')).not.toBeInTheDocument();

    search('');
    expect(screen.getByText('Задача #13')).toBeInTheDocument();
    expect(screen.queryByText('Задача #14')).not.toBeInTheDocument();
  });

  it('says so when nothing matches', () => {
    renderList({ jobs });
    search('no such thing');
    expect(screen.getByText('Ничего не найдено по запросу')).toBeInTheDocument();
    expect(screen.queryByText('Задача #11')).not.toBeInTheDocument();
  });
});

describe('JobList running time', () => {
  afterEach(() => vi.useRealTimers());

  it('counts up on screen for a running job, once a second, and stops for finished ones', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-16T12:00:30.000Z'));

    const running = {
      ...job,
      id: 1,
      status: 'running',
      startedAt: '2026-10-16T12:00:00.000Z',
      finishedAt: null,
    } as unknown as WorkerJob;
    const done = {
      ...job,
      id: 2,
      status: 'succeeded',
      startedAt: '2026-10-16T11:00:00.000Z',
      finishedAt: '2026-10-16T11:01:00.000Z',
    } as unknown as WorkerJob;

    renderList({ jobs: [running, done] });
    expect(screen.getByText(/30 с/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByText(/35 с/)).toBeInTheDocument();
    // the finished job keeps its own fixed duration
    expect(screen.getAllByText(/1 мин 00 с/)).toHaveLength(1);
  });

  it('does not tick when nothing is running', () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(globalThis, 'setInterval');

    renderList({ jobs: [job] });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('JobList row layout', () => {
  it('gives every row a task chip cell and an actions cell, so rows line up even without a task', () => {
    const withTask = { ...job, id: 1, taskKey: 'improve:481' } as unknown as WorkerJob;
    const withoutTask = { ...job, id: 2, taskKey: null } as unknown as WorkerJob;

    renderList({ jobs: [withTask, withoutTask] });

    for (const item of screen.getAllByRole('listitem')) {
      // row button, chip (or its placeholder), actions
      expect(item.children).toHaveLength(3);
    }
    expect(screen.getByTitle(/Показать все запуски этой задачи: improve:481/)).toBeInTheDocument();
  });

  it('keeps the whole error text available on a failed row', () => {
    const failed = {
      ...job,
      id: 3,
      status: 'failed',
      errorMessage: 'API Error: No response from API (waited 3m, then 10m on the retry)',
    } as unknown as WorkerJob;

    renderList({ jobs: [failed] });

    expect(screen.getByTitle(failed.errorMessage as string)).toBeInTheDocument();
  });
});
