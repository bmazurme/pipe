import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewJobForm } from './NewJobForm';
import { store } from '../../store';
import { contextApi, storageApi, workerApi } from '../../store/api';

let filesFail: boolean;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  filesFail = true;
  store.dispatch(contextApi.util.resetApiState());
  store.dispatch(workerApi.util.resetApiState());
  store.dispatch(storageApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');

      if (path === 'storage/files' || path === 'storage') {
        return filesFail ? json({ message: 'boom' }, 500) : json([{ id: 1, originalName: 'task.zip', size: 10, createdAt: '2026-10-08T00:00:00Z' }]);
      }
      if (path === 'worker/jobs/history') return json({ count: 0 });

      return json([]);
    }),
  );
});

const renderForm = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <MemoryRouter>
          <NewJobForm onCreated={() => {}} />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );

describe('NewJobForm file list failure', () => {
  it('shows an error with a retry instead of the empty text, and recovers', async () => {
    const user = userEvent.setup();
    renderForm();

    expect(await screen.findByText('Не удалось загрузить список посылок')).toBeInTheDocument();
    expect(screen.queryByText(/В Storage нет посылок/)).not.toBeInTheDocument();

    filesFail = false;
    await user.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(await screen.findByText('Посылка')).toBeInTheDocument();
    expect(screen.queryByText('Не удалось загрузить список посылок')).not.toBeInTheDocument();
  });
});
