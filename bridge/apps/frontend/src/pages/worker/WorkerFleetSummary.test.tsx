import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FleetWorker } from '../../store/api';
import { WorkerFleetSummary } from './WorkerFleetSummary';

const updateWorker = vi.fn();

vi.mock('../../store/api', () => ({
  useUpdateWorkerMutation: () => [updateWorker, { isLoading: false }],
}));

function worker(over: Partial<FleetWorker> = {}): FleetWorker {
  return {
    id: 1,
    name: 'green',
    kind: 'managed',
    state: 'idle',
    enabled: true,
    activeJobs: 0,
    ...over,
  } as FleetWorker;
}

const view = (workers: FleetWorker[]) =>
  render(
    <ThemeProvider theme="light">
      <WorkerFleetSummary workers={workers} isLoading={false} jobs={[]} />
    </ThemeProvider>,
  );

describe('WorkerFleetSummary bulk pause', () => {
  beforeEach(() => {
    updateWorker.mockReset();
    updateWorker.mockImplementation(() => ({ unwrap: () => Promise.resolve({}) }));
  });

  it('pauses every enabled enrolled worker', async () => {
    view([worker({ id: 1 }), worker({ id: 2 }), worker({ id: 3, enabled: false, state: 'paused' })]);
    fireEvent.click(screen.getByRole('button', { name: /Приостановить всех/ }));

    await waitFor(() => expect(updateWorker).toHaveBeenCalledTimes(2));
    expect(updateWorker).toHaveBeenCalledWith({ id: 1, enabled: false });
    expect(updateWorker).toHaveBeenCalledWith({ id: 2, enabled: false });
  });

  it('resumes all when everyone is paused', async () => {
    view([worker({ id: 1, enabled: false, state: 'paused' }), worker({ id: 2, enabled: false, state: 'paused' })]);
    fireEvent.click(screen.getByRole('button', { name: /Возобновить всех/ }));

    await waitFor(() => expect(updateWorker).toHaveBeenCalledTimes(2));
    expect(updateWorker).toHaveBeenCalledWith({ id: 1, enabled: true });
    expect(updateWorker).toHaveBeenCalledWith({ id: 2, enabled: true });
  });

  it('reports a partial failure', async () => {
    updateWorker.mockImplementation(({ id }: { id: number }) => ({
      unwrap: () => (id === 2 ? Promise.reject(new Error('x')) : Promise.resolve({})),
    }));
    view([worker({ id: 1 }), worker({ id: 2 })]);
    fireEvent.click(screen.getByRole('button', { name: /Приостановить всех/ }));

    expect(await screen.findByText('Не удалось изменить: 1 из 2')).toBeTruthy();
    expect(updateWorker).toHaveBeenCalledTimes(2);
  });

  it('is hidden with no enrolled workers', () => {
    view([worker({ id: 9, kind: 'legacy' }), worker({ id: 5, state: 'pending' })]);
    expect(screen.queryByRole('button', { name: /всех/ })).toBeNull();
  });
});
