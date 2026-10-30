import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { SecretsPage } from '../SecretsPage';
import { store } from '../../store';
import { secretsApi } from '../../store/api';
import { parseEnvFile } from './parseEnvFile';

const secret = { id: 1, name: 'A', description: null, expiresOn: null, createdAt: '', updatedAt: '' };

beforeEach(() => {
  store.dispatch(secretsApi.util.resetApiState());
});

function renderPage() {
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <SecretsPage />
      </ThemeProvider>
    </Provider>,
  );
}

describe('ExportEnvButton', () => {
  it('does not call export on load, then one request and one download on click', async () => {
    const user = userEvent.setup();
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        urls.push(request.url);
        if (request.url.endsWith('/secrets/export')) {
          return new Response('A="x y"\n', { status: 200, headers: { 'content-type': 'text/plain' } });
        }
        return new Response(JSON.stringify([secret]), { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );
    const createObjectURL = vi.fn(() => 'blob:x');
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderPage();
    await waitFor(() => expect((screen.getByText('Скачать .env').closest('button') as HTMLButtonElement).disabled).toBe(false));
    expect(urls.some((u) => u.endsWith('/secrets/export'))).toBe(false);

    await user.click(screen.getByText('Скачать .env'));

    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(urls.filter((u) => u.endsWith('/secrets/export'))).toHaveLength(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('is disabled when there are no secrets', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText('Скачать .env')).toBeTruthy());
    expect((screen.getByText('Скачать .env').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('round-trips quoted values through parseEnvFile', () => {
    const text = 'A="a b"\nB="x#y"\nC=a=b\nD="it\'s"\n';
    expect(parseEnvFile(text).entries).toEqual([
      { name: 'A', value: 'a b' },
      { name: 'B', value: 'x#y' },
      { name: 'C', value: 'a=b' },
      { name: 'D', value: "it's" },
    ]);
  });
});
