import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { SecretsPage } from './SecretsPage';
import { store } from '../store';
import { secretsApi } from '../store/api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  store.dispatch(secretsApi.util.resetApiState());
});

describe('SecretsPage .env import', () => {
  it('creates new names, skips existing ones and reports counts', async () => {
    const user = userEvent.setup();
    const posted: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.url.endsWith('/secrets') && request.method === 'POST') {
          const body = JSON.parse(await request.clone().text());
          posted.push(body.name);
          if (body.name === 'EXISTING') return jsonResponse({ message: 'exists' }, 409);
          return jsonResponse({ id: posted.length, name: body.name, description: null, createdAt: '', updatedAt: '' }, 201);
        }
        return jsonResponse([]);
      }),
    );

    render(
      <Provider store={store}>
        <ThemeProvider theme="light">
          <SecretsPage />
        </ThemeProvider>
      </Provider>,
    );

    const file = new File(['A=1\nB=2\nEXISTING=x\nC=3\nbroken\n'], '.env', { type: 'text/plain' });
    await user.upload(screen.getByTestId('import-env-input'), file);

    await waitFor(() => expect(screen.getByText(/Импортировано: 3, пропущено: 1, строк не распознано: 1/)).toBeTruthy());
    expect(posted).toEqual(['A', 'B', 'EXISTING', 'C']);
  });
});
