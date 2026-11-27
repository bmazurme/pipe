import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@gravity-ui/uikit';
import { Provider } from 'react-redux';

import { StepUpProvider } from './StepUpProvider';
import { store } from '../../store';
import { sessionsApi } from '../../store/api';
import { clearStepUpGrant, currentStepUpGrant, requestStepUp } from '../../store/step-up';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let verifyAnswer: () => Response;
let sentCodes: string[];

beforeEach(() => {
  clearStepUpGrant();
  sentCodes = [];
  verifyAnswer = () =>
    jsonResponse({ token: 'grant-token', expiresAt: new Date(Date.now() + 300_000).toISOString() });
  store.dispatch(sessionsApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      if (new URL(request.url).pathname.endsWith('/auth/2fa/verify')) {
        sentCodes.push((await request.json()).code);

        return verifyAnswer();
      }

      return jsonResponse({}, 404);
    }),
  );
});

function renderProvider() {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <StepUpProvider />
      </ThemeProvider>
    </Provider>,
  );
}

describe('StepUpProvider', () => {
  it('shows nothing until an action needs a code', () => {
    renderProvider();

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks for a code, keeps the grant and answers yes', async () => {
    renderProvider();

    const asked = requestStepUp();

    await userEvent.type(await screen.findByLabelText('Код'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));

    await expect(asked).resolves.toBe(true);
    expect(sentCodes).toEqual(['123456']);
    expect(currentStepUpGrant()).toBe('grant-token');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('stays open and says so on a wrong code, so the person can try the next one', async () => {
    verifyAnswer = () => jsonResponse({ code: 'STEP_UP_INVALID_CODE', message: 'Wrong code' }, 403);
    renderProvider();

    const asked = requestStepUp();

    await userEvent.type(await screen.findByLabelText('Код'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));

    expect(await screen.findByText(/Код не подошёл/)).toBeTruthy();
    expect(currentStepUpGrant()).toBeNull();

    verifyAnswer = () => jsonResponse({ token: 'second', expiresAt: new Date(Date.now() + 300_000).toISOString() });
    await userEvent.clear(screen.getByLabelText('Код'));
    await userEvent.type(screen.getByLabelText('Код'), '654321');
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));

    await expect(asked).resolves.toBe(true);
    expect(currentStepUpGrant()).toBe('second');
  });

  it('answers no when the dialog is cancelled', async () => {
    renderProvider();

    const asked = requestStepUp();

    await userEvent.click(await screen.findByRole('button', { name: 'Отмена' }));

    await expect(asked).resolves.toBe(false);
    expect(sentCodes).toEqual([]);
  });

  it('says the factor is locked when the server says so', async () => {
    verifyAnswer = () => jsonResponse({ code: 'STEP_UP_LOCKED', message: 'locked' }, 429);
    renderProvider();

    void requestStepUp();
    await userEvent.type(await screen.findByLabelText('Код'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));

    expect(await screen.findByText(/Слишком много неверных кодов/)).toBeTruthy();
  });
});
