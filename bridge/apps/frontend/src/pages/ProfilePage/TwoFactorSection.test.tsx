import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';

import { TwoFactorSection } from './TwoFactorSection';
import { store } from '../../store';
import { sessionsApi } from '../../store/api';

const OFF = { enabled: false, setupPending: false, recoveryCodesLeft: 0, enforced: false };
const ON = { enabled: true, setupPending: false, recoveryCodesLeft: 10, enforced: false };
const CODES = ['aaaa-bbbb-cccc-dddd', 'eeee-ffff-gggg-hhhh'];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let status: unknown;
let requests: string[];
let bodies: Record<string, unknown>;

beforeEach(() => {
  status = OFF;
  requests = [];
  bodies = {};
  store.dispatch(sessionsApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const { pathname } = new URL(request.url);
      const route = pathname.replace('/api/v1', '');

      requests.push(`${request.method} ${route}`);

      if (request.method !== 'GET') bodies[route] = await request.json().catch(() => null);

      if (route === '/auth/2fa') return jsonResponse(status);
      if (route === '/auth/2fa/setup') {
        return jsonResponse({ secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/x' }, 201);
      }
      if (route === '/auth/2fa/enable') {
        status = ON;

        return jsonResponse({ recoveryCodes: CODES });
      }
      if (route === '/auth/2fa/disable') {
        status = OFF;

        return new Response(null, { status: 204 });
      }

      return jsonResponse({}, 404);
    }),
  );
});

function renderSection() {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <MemoryRouter>
          <TwoFactorSection />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );
}

describe('TwoFactorSection', () => {
  it('warns that dangerous actions are unprotected while it is off', async () => {
    renderSection();

    expect(await screen.findByText(/Защита выключена: опасные действия сейчас подтверждения не требуют/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Включить' })).toBeTruthy();
  });

  it('says so when the server refuses guarded actions until it is on', async () => {
    status = { ...OFF, enforced: true };
    renderSection();

    expect(await screen.findByText(/пока вы её не включите, они недоступны/)).toBeTruthy();
  });

  it('sets up, confirms with the first code and shows the recovery codes once', async () => {
    renderSection();

    await screen.findByText(/Защита выключена/);
    await userEvent.click(screen.getByRole('button', { name: 'Включить' }));

    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Первый код'), '123456');
    await userEvent.click(screen.getAllByRole('button', { name: 'Включить' }).at(-1)!);

    expect(await screen.findByText(CODES[0])).toBeTruthy();
    expect(bodies['/auth/2fa/enable']).toEqual({ code: '123456' });

    await userEvent.click(screen.getByRole('button', { name: 'Я сохранил(а)' }));
    await waitFor(() => expect(screen.queryByText(CODES[0])).toBeNull());
    expect(await screen.findByText('Включена')).toBeTruthy();
    expect(screen.getByText(/кодов восстановления осталось: 10/)).toBeTruthy();
  });

  it('will not send an empty or too-short first code', async () => {
    renderSection();

    await screen.findByText(/Защита выключена/);
    await userEvent.click(screen.getByRole('button', { name: 'Включить' }));
    await screen.findByText('JBSWY3DPEHPK3PXP');
    await userEvent.type(screen.getByLabelText('Первый код'), '123');

    expect((screen.getAllByRole('button', { name: 'Включить' }).at(-1) as HTMLButtonElement).disabled).toBe(true);
    expect(requests).not.toContain('POST /auth/2fa/enable');
  });

  it('turns off only after a code is given', async () => {
    status = ON;
    renderSection();

    await userEvent.click(await screen.findByRole('button', { name: 'Выключить' }));
    expect(requests).not.toContain('POST /auth/2fa/disable');

    await userEvent.type(await screen.findByLabelText('Код'), '123456');
    await userEvent.click(screen.getAllByRole('button', { name: 'Выключить' }).at(-1)!);

    await waitFor(() => expect(bodies['/auth/2fa/disable']).toEqual({ code: '123456' }));
    expect(await screen.findByText(/Защита выключена/)).toBeTruthy();
  });

  it('suggests new recovery codes when few are left', async () => {
    status = { ...ON, recoveryCodesLeft: 2 };
    renderSection();

    expect(await screen.findByText(/пора выпустить новые/)).toBeTruthy();
  });
});
