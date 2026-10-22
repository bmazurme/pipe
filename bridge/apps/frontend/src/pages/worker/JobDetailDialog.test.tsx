import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { JobDetailDialog } from './JobDetailDialog';

// The store is shared between tests, so each test uses its own job id to start from an empty cache.
const job = (id: number) => ({
  id,
  model: 'sonnet',
  status: 'succeeded',
  logs: 'done',
  createdAt: '2026-10-08T00:00:00Z',
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let calls: string[];
let routes: Record<string, () => Response | Promise<Response>>;

const renderDialog = (jobId: number, onClose = vi.fn()) => {
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <JobDetailDialog jobId={jobId} onClose={onClose} />
      </ThemeProvider>
    </Provider>,
  );

  return onClose;
};

// Opens the delete confirmation once the job's dialog has finished opening (its focus trap
// is on, so the rest of the page is inert): a nested dialog opened mid-transition gets
// marked inert by its parent, which only a test can click fast enough to hit.
const openDeleteConfirmation = async (jobId: number) => {
  const user = userEvent.setup();
  const deleteButton = await screen.findByRole('button', { name: 'Удалить' });
  await waitFor(() => expect(document.body.firstElementChild?.getAttribute('aria-hidden')).toBe('true'));
  await user.click(deleteButton);

  return { user, confirm: await screen.findByRole('dialog', { name: `Удалить задачу #${jobId}?` }) };
};

beforeEach(() => {
  calls = [];
  routes = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const call = `${request.method} ${new URL(request.url).pathname.replace('/api/v1/', '')}`;
      calls.push(call);

      return routes[call]?.() ?? json({ message: 'Not Found' }, 404);
    }),
  );
});

describe('JobDetailDialog', () => {
  it('shows an open dialog with a loader while the job is loading', async () => {
    routes['GET worker/jobs/101'] = () => new Promise<Response>(() => {});
    renderDialog(101);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Задача #101')).toBeTruthy();
    expect(dialog.querySelector('.g-loader')).toBeTruthy();
  });

  it('says the job could not be loaded and can be closed', async () => {
    const user = userEvent.setup();
    const onClose = renderDialog(102);

    expect(await screen.findByText('Не удалось загрузить задачу')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Закрыть' }));

    expect(onClose).toHaveBeenCalled();
  });

  it('leaves the job alone when deleting is cancelled', async () => {
    routes['GET worker/jobs/103'] = () => json(job(103));
    const onClose = renderDialog(103);

    const { user, confirm } = await openDeleteConfirmation(103);
    await user.click(await within(confirm).findByRole('button', { name: 'Отмена' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Удалить задачу #103?' })).toBeNull());
    expect(calls).not.toContain('DELETE worker/jobs/103');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('deletes the job once confirmed and closes', async () => {
    routes['GET worker/jobs/104'] = () => json(job(104));
    routes['DELETE worker/jobs/104'] = () => new Response(null, { status: 200 });
    const onClose = renderDialog(104);

    const { user, confirm } = await openDeleteConfirmation(104);
    await user.click(await within(confirm).findByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls).toContain('DELETE worker/jobs/104');
  });

  it('shows an error when the result cannot be downloaded', async () => {
    const user = userEvent.setup();
    routes['GET worker/jobs/105'] = () => json(job(105));
    renderDialog(105);

    await user.click(await screen.findByRole('button', { name: 'Скачать результат' }));

    expect(await screen.findByText('Не удалось скачать результат')).toBeTruthy();
    expect(calls).toContain('GET worker/jobs/105/result/download');
  });

  it('shows what a running job is doing, with its worker and elapsed time', async () => {
    routes['GET worker/jobs/21'] = () =>
      json({
        ...job(21),
        status: 'running',
        workerName: 'pi-blue',
        contextName: 'crm',
        taskKey: '402:8',
        logs: 'step 1\n',
        startedAt: new Date(Date.now() - 65_000).toISOString(),
        finishedAt: null,
      });
    renderDialog(21);

    expect(await screen.findByText('Выполняется на pi-blue')).toBeInTheDocument();
    expect(screen.getByLabelText('Время выполнения')).toHaveTextContent(/1 мин/);
    // The facts about the job sit in a labelled list instead of a row of dots.
    const fields = screen.getByText('Контекст').closest('dl') as HTMLElement;
    expect(within(fields).getByText('crm')).toBeInTheDocument();
    expect(within(fields).getByText('402:8')).toBeInTheDocument();
    expect(within(fields).getByText('pi-blue')).toBeInTheDocument();
  });

  it('shows the log with a line count', async () => {
    routes['GET worker/jobs/22'] = () => json({ ...job(22), logs: 'a\nb\n' });
    renderDialog(22);

    expect(await screen.findByText(/2 строк/)).toBeInTheDocument();
  });

  it('keeps the same blocks from the moment the job is queued to the moment it ends, so the window does not change shape', async () => {
    routes['GET worker/jobs/23'] = () => json({ ...job(23), status: 'queued', createdAt: new Date().toISOString(), targetWorkerId: null, workerName: null, logs: '' });
    routes['GET worker/jobs/24'] = () => json({ ...job(24), status: 'succeeded', workerName: 'pi-blue', logs: 'done\n' });

    const queued = render(
      <Provider store={store}>
        <ThemeProvider theme="light">
          <JobDetailDialog jobId={23} onClose={vi.fn()} />
        </ThemeProvider>
      </Provider>,
    );
    // Queued: the worker is not known yet, but its place is there, and so is the stage line and the log box.
    const worker = (await screen.findByText('Worker')).closest('div') as HTMLElement;
    expect(within(worker).getByText('—')).toBeInTheDocument();
    expect(screen.getByText(/Ждёт свободный worker/)).toBeInTheDocument();
    expect(screen.getByText('(пока пусто)')).toBeInTheDocument();
    queued.unmount();

    render(
      <Provider store={store}>
        <ThemeProvider theme="light">
          <JobDetailDialog jobId={24} onClose={vi.fn()} />
        </ThemeProvider>
      </Provider>,
    );
    // Finished: the stage line is replaced by the outcome, not removed.
    expect(await screen.findByText('Готово — результат можно скачать')).toBeInTheDocument();
    expect(within((await screen.findByText('Worker')).closest('div') as HTMLElement).getByText('pi-blue')).toBeInTheDocument();
  });
});

describe('JobDetailDialog time limit', () => {
  it('shows the limit chosen at launch, and nothing when the worker setting applies', async () => {
    routes['GET worker/jobs/31'] = () => json({ ...job(31), timeoutSec: 7200 });
    routes['GET worker/jobs/32'] = () => json({ ...job(32), timeoutSec: null });

    renderDialog(31);
    const fields = (await screen.findByText('Лимит времени')).closest('dl') as HTMLElement;
    expect(within(fields).getByText('2 ч')).toBeInTheDocument();
    cleanup();

    renderDialog(32);
    expect(await screen.findByText('Worker')).toBeInTheDocument();
    expect(screen.queryByText('Лимит времени')).toBeNull();
  });
});
