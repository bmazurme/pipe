import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { ProvisionServerForm } from './ProvisionServerForm';
import { store } from '../../store';
import { secretsApi } from '../../store/api';

function renderForm() {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <ProvisionServerForm />
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

async function fillForm(user: ReturnType<typeof userEvent.setup>) {
  const [host] = screen.getAllByRole('textbox');
  await user.type(host, '203.0.113.10');
  await user.type(passwordInput(), 'secret');
}

function passwordInput() {
  return document.querySelector('input[type="password"]') as HTMLInputElement;
}

beforeEach(() => {
  store.dispatch(secretsApi.util.resetApiState());
});

describe('ProvisionServerForm', () => {
  it('keeps submit disabled until host, user and password are filled', async () => {
    const user = userEvent.setup();
    renderForm();

    const submit = screen.getByRole('button', { name: 'Создать' });
    expect(submit).toBeDisabled();

    await fillForm(user);
    expect(submit).toBeEnabled();
  });

  it('clears the password and names the Actions tab on success', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})));
    renderForm();

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Создать' }));

    expect(await screen.findByText(/вкладку «Actions»/)).toBeInTheDocument();
    expect(passwordInput().value).toBe('');
  });

  it('shows the API error message when provisioning fails', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: 'GitHub token is not configured' }, 503)));
    renderForm();

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Создать' }));

    await waitFor(() =>
      expect(
        screen.getByText(/Не удалось запустить настройку сервера — GitHub token is not configured/),
      ).toBeInTheDocument(),
    );
  });
});
