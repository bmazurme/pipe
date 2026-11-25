import { render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewJobForm } from './NewJobForm';
import { store } from '../../store';
import { contextApi, storageApi, workerApi } from '../../store/api';

type Sent = { path: string; body: unknown };
let sent: Sent[];

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  sent = [];
  store.dispatch(contextApi.util.resetApiState());
  store.dispatch(workerApi.util.resetApiState());
  store.dispatch(storageApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');

      if (request.method !== 'GET') {
        sent.push({ path, body: await request.json().catch(() => undefined) });

        return json({ id: 50 });
      }
      if (path === 'storage/files' || path === 'storage') return json([{ id: 1, originalName: 'task.subscription.zip', size: 10, createdAt: '2026-10-08T00:00:00Z' }, { id: 2, originalName: 'other.zip', size: 10, createdAt: '2026-10-08T00:00:00Z' }]);
      if (path === 'worker/jobs/history') return json({ count: 0 });

      return json([]);
    }),
  );
  try {
    localStorage.clear();
  } catch {
    // Not available — the form must work without it.
  }
});

function Where() {
  const location = useLocation();

  return <div data-testid="where">{location.pathname + location.search}</div>;
}

const renderAt = (url: string) =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <MemoryRouter initialEntries={[url]}>
          <NewJobForm onCreated={() => {}} />
          <Where />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );

describe('NewJobForm preselected parcel', () => {
  it('preselects a known parcel, drops the param and keeps the others', async () => {
    renderAt('/worker?tab=jobs&sourceFileId=2');

    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/worker?tab=jobs'));
    expect(await screen.findByText('other.zip')).toBeTruthy();
    expect(sent).toHaveLength(0);
  });

  it('ignores an unknown id without an error', async () => {
    renderAt('/worker?sourceFileId=999');

    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/worker'));
    expect(screen.queryByText('other.zip')).toBeNull();
    expect(screen.queryByText('task.subscription.zip')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
