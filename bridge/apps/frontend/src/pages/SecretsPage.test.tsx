import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { SecretsPage } from './SecretsPage';
import { store } from '../store';
import { secretsApi } from '../store/api';

const SECRETS = [
  { id: 1, name: 'github-token', description: 'CI access', createdAt: '2026-09-30T07:00:00.000Z', updatedAt: '2026-09-30T07:00:00.000Z' },
  { id: 2, name: 'api-key', description: null, createdAt: '2026-09-30T08:00:00.000Z', updatedAt: '2026-09-30T08:00:00.000Z' },
];

function renderPage() {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <SecretsPage />
      </ThemeProvider>
    </Provider>,
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  store.dispatch(secretsApi.util.resetApiState());
});

describe('SecretsPage', () => {
  it('lists existing secrets with their description, values masked by default', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (request.url.endsWith('/secrets')) return jsonResponse(SECRETS);
        return jsonResponse([]);
      }),
    );

    renderPage();

    await screen.findByText('github-token');
    expect(screen.getByText('CI access')).toBeTruthy();
    expect(screen.getByText('api-key')).toBeTruthy();
    expect(screen.getAllByText('••••••••')).toHaveLength(2);
  });

  it('shows the empty state when there are no secrets yet', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([])));

    renderPage();

    await screen.findByText('Секретов пока нет');
  });

  it('creates a new secret', async () => {
    const user = userEvent.setup();
    let createdBody: unknown;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = request.url;
        if (url.endsWith('/secrets') && request.method === 'POST') {
          createdBody = JSON.parse(await request.clone().text());
          return jsonResponse({ id: 3, name: 'new-secret', description: null, createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z' });
        }
        if (url.endsWith('/secrets')) return jsonResponse([]);
        return jsonResponse([]);
      }),
    );

    renderPage();
    await screen.findByText('Секретов пока нет');

    await user.type(screen.getByPlaceholderText('Имя'), 'new-secret');
    await user.type(screen.getByPlaceholderText('Значение'), 'super-secret-value');
    await user.click(screen.getByText('Добавить'));

    await waitFor(() =>
      expect(createdBody).toEqual({ name: 'new-secret', value: 'super-secret-value' }),
    );
  });

  it('reveals a secret value on click and hides it again on a second click', async () => {
    const user = userEvent.setup();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = request.url;
        if (url.endsWith('/secrets')) return jsonResponse(SECRETS);
        if (url.endsWith('/secrets/1/value')) return jsonResponse({ value: 'ghp_realtoken' });
        return jsonResponse([]);
      }),
    );

    renderPage();
    await screen.findByText('github-token');

    await user.click(screen.getByLabelText('Показать значение github-token'));
    await screen.findByText('ghp_realtoken');

    await user.click(screen.getByLabelText('Скрыть значение github-token'));
    await waitFor(() => expect(screen.queryByText('ghp_realtoken')).toBeNull());
  });

  it('deletes a secret after a second confirming click', async () => {
    const user = userEvent.setup();
    let deletedId: number | undefined;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = request.url;
        if (url.endsWith('/secrets') && request.method !== 'DELETE') return jsonResponse(SECRETS);
        if (url.includes('/secrets/') && request.method === 'DELETE') {
          deletedId = Number(url.split('/').pop());
          return new Response(null, { status: 204 });
        }
        return jsonResponse([]);
      }),
    );

    renderPage();
    await screen.findByText('github-token');

    const deleteButton = screen.getByLabelText('Удалить github-token');
    await user.click(deleteButton);
    await user.click(screen.getByLabelText('Подтвердить удаление github-token'));

    await waitFor(() => expect(deletedId).toBe(1));
  });

  it('edits a secret’s name without sending a new value when the value field is left blank', async () => {
    const user = userEvent.setup();
    let updatedBody: unknown;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const url = request.url;
        if (url.endsWith('/secrets') && request.method !== 'PATCH') return jsonResponse(SECRETS);
        if (url.includes('/secrets/2') && request.method === 'PATCH') {
          updatedBody = JSON.parse(await request.clone().text());
          return jsonResponse({ id: 2, name: 'renamed-key', description: null, createdAt: '2026-09-30T08:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z' });
        }
        return jsonResponse([]);
      }),
    );

    renderPage();
    await screen.findByText('api-key');

    await user.click(screen.getByLabelText('Изменить api-key'));
    const nameInput = screen.getByDisplayValue('api-key');
    await user.clear(nameInput);
    await user.type(nameInput, 'renamed-key');
    await user.click(screen.getByLabelText('Сохранить'));

    await waitFor(() =>
      expect(updatedBody).toEqual({ name: 'renamed-key', description: '' }),
    );
  });
});
