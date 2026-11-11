import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { VpnPage } from './VpnPage';
import { store } from '../store';
import { vpnApi } from '../store/api';

const SUBSCRIPTION_STATUS = {
  lastOnline: new Date().toISOString(),
  upBytes: 0,
  downBytes: 0,
  sni: 'miro.com',
  fingerprint: 'firefox',
  port: 443,
  source: 'subscription',
};

const CONNECTIONS = [
  { id: 1, name: 'PaperVPN', kind: 'subscription', serverAddress: '203.0.113.9', isActive: true, createdAt: '2026-11-11T07:00:00.000Z' },
  { id: 2, name: 'panel-box', kind: 'panel', serverAddress: '203.0.113.6', isActive: false, createdAt: '2026-09-30T08:00:00.000Z' },
];

const SUB_URL = 'https://api.provider.example/sub/SECRET-123#PaperVPN';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function renderPage() {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <VpnPage />
      </ThemeProvider>
    </Provider>,
  );
}

type Handler = (request: Request) => Promise<Response | undefined> | Response | undefined;

function serve(extra: Handler = () => undefined) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const custom = await extra(request);
      if (custom) return custom;
      if (request.url.endsWith('/vpn/status')) return json(SUBSCRIPTION_STATUS);
      if (request.url.endsWith('/vpn/connections')) return json(CONNECTIONS);

      return json({});
    }),
  );
}

beforeEach(() => {
  store.dispatch(vpnApi.util.resetApiState());
});

describe('VpnPage: connections by subscription link', () => {
  describe('adding one', () => {
    it('offers the subscription link first, takes the name after the #, and sends only the link and the name', async () => {
      const user = userEvent.setup();
      let body: unknown;
      serve(async (request) => {
        if (request.url.endsWith('/vpn/connections') && request.method === 'POST') {
          body = JSON.parse(await request.clone().text());

          return json({ id: 3, name: 'PaperVPN', kind: 'subscription', serverAddress: '203.0.113.9', isActive: false, createdAt: '2026-11-11T00:00:00.000Z' });
        }

        return undefined;
      });

      renderPage();
      await screen.findByText('panel-box');
      await user.click(screen.getByText('Новое подключение'));

      // The panel fields are not on screen until the other kind is picked.
      expect(screen.queryByText('API-токен панели')).toBeNull();

      await user.type(screen.getByPlaceholderText('https://провайдер.example/…#Название'), SUB_URL);

      // The name was taken from what follows the # of the link.
      expect(screen.getByDisplayValue('PaperVPN')).toBeTruthy();

      await user.click(screen.getByText('Добавить подключение'));

      await waitFor(() => expect(body).toEqual({ name: 'PaperVPN', subscriptionUrl: SUB_URL }));
    });

    it('lets the owner rename it, and falls back to the name in the link, then to the host, when the name is blank', async () => {
      const user = userEvent.setup();
      const bodies: Array<{ name: string }> = [];
      serve(async (request) => {
        if (request.url.endsWith('/vpn/connections') && request.method === 'POST') {
          bodies.push(JSON.parse(await request.clone().text()));

          return json({ id: 3, name: 'x', kind: 'subscription', serverAddress: 'a', isActive: false, createdAt: '2026-11-11T00:00:00.000Z' });
        }

        return undefined;
      });

      renderPage();
      await screen.findByText('panel-box');

      await user.click(screen.getByText('Новое подключение'));
      await user.type(screen.getByPlaceholderText('https://провайдер.example/…#Название'), SUB_URL);
      const name = screen.getByDisplayValue('PaperVPN');
      await user.clear(name);
      await user.type(name, 'Мой VPN');
      await user.click(screen.getByText('Добавить подключение'));
      await waitFor(() => expect(bodies).toHaveLength(1));
      expect(bodies[0].name).toBe('Мой VPN');

      await user.click(await screen.findByText('Новое подключение'));
      expect(screen.getByPlaceholderText('Подставится из ссылки (после #)')).toHaveValue('');
      await user.type(screen.getByPlaceholderText('https://провайдер.example/…#Название'), 'https://api.provider.example/sub/NOFRAG');
      await user.click(screen.getByText('Добавить подключение'));
      await waitFor(() => expect(bodies).toHaveLength(2));
      expect(bodies[1].name).toBe('api.provider.example');
    });

    it('will not send a link that is not https://', async () => {
      const user = userEvent.setup();
      serve();

      renderPage();
      await screen.findByText('panel-box');
      await user.click(screen.getByText('Новое подключение'));
      await user.type(screen.getByPlaceholderText('https://провайдер.example/…#Название'), 'http://api.provider.example/sub');

      expect(screen.getByText('Нужна ссылка https://…')).toBeTruthy();
      expect((screen.getByRole('button', { name: 'Добавить подключение' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("shows bridge's reason when it could not read the link, and keeps the form", async () => {
      const user = userEvent.setup();
      serve((request) =>
        request.url.endsWith('/vpn/connections') && request.method === 'POST'
          ? json({ message: 'VPN «PaperVPN»: подписка ответила 403' }, 502)
          : undefined,
      );

      renderPage();
      await screen.findByText('panel-box');
      await user.click(screen.getByText('Новое подключение'));
      await user.type(screen.getByPlaceholderText('https://провайдер.example/…#Название'), SUB_URL);
      await user.click(screen.getByText('Добавить подключение'));

      expect(await screen.findByText('VPN «PaperVPN»: подписка ответила 403')).toBeTruthy();
      expect(screen.getByPlaceholderText('https://провайдер.example/…#Название')).toHaveValue(SUB_URL);
    });

    it('still offers the panel form under the other tab', async () => {
      const user = userEvent.setup();
      serve();

      renderPage();
      await screen.findByText('panel-box');
      await user.click(screen.getByText('Новое подключение'));
      await user.click(screen.getByText('Панель 3x-ui'));

      expect(screen.getByText('API-токен панели')).toBeTruthy();
      expect(screen.queryByPlaceholderText('https://провайдер.example/…#Название')).toBeNull();
    });
  });

  describe('a row', () => {
    it('is marked as a subscription with its server, and its status says the server answers, with no traffic counters', async () => {
      serve();

      renderPage();

      const row = (await screen.findByText('подписка · 203.0.113.9')).closest('li') as HTMLElement;

      expect(await within(row).findByText(/отвечает/)).toBeTruthy();
      expect(within(row).getByText('Сервер')).toBeTruthy();
      expect(within(row).queryByText('Трафик')).toBeNull();
      expect(within(row).getByText('miro.com')).toBeTruthy();
    });

    it('does not mark a panel connection that way', async () => {
      serve();

      renderPage();
      await screen.findByText('panel-box');

      expect(screen.getAllByText(/подписка ·/)).toHaveLength(1);
    });

    it('edits only the name and the link: no panel fields, and a blank link means "keep"', async () => {
      const user = userEvent.setup();
      const bodies: unknown[] = [];
      serve(async (request) => {
        if (request.url.includes('/vpn/connections/1') && request.method === 'PATCH') {
          bodies.push(JSON.parse(await request.clone().text()));

          return json({ ...CONNECTIONS[0] });
        }

        return undefined;
      });

      renderPage();
      await screen.findByText('PaperVPN');
      await user.click(screen.getByLabelText('Изменить подключение: PaperVPN'));

      expect(screen.queryByText('URL панели')).toBeNull();
      expect(screen.queryByText('Адрес сервера')).toBeNull();
      expect(screen.getByText('Ссылка подписки')).toBeTruthy();

      const name = screen.getByDisplayValue('PaperVPN');
      await user.clear(name);
      await user.type(name, 'Paper 2');
      await user.click(screen.getByText('Сохранить'));
      await waitFor(() => expect(bodies).toHaveLength(1));
      expect(bodies[0]).toEqual({ name: 'Paper 2' });

      await user.click(screen.getByLabelText('Изменить подключение: PaperVPN'));
      await user.type(screen.getByPlaceholderText('оставьте пустым, чтобы не менять'), 'https://api.provider.example/sub/NEW');
      await user.click(screen.getByText('Сохранить'));
      await waitFor(() => expect(bodies).toHaveLength(2));
      expect(bodies[1]).toEqual({ name: 'PaperVPN', subscriptionUrl: 'https://api.provider.example/sub/NEW' });
    });

    it("shows the server's reason when the new link is refused", async () => {
      const user = userEvent.setup();
      serve((request) =>
        request.url.includes('/vpn/connections/1') && request.method === 'PATCH'
          ? json({ message: 'VPN «подписка»: в подписке нет ссылки, с которой можно поднять туннель' }, 502)
          : undefined,
      );

      renderPage();
      await screen.findByText('PaperVPN');
      await user.click(screen.getByLabelText('Изменить подключение: PaperVPN'));
      await user.type(screen.getByPlaceholderText('оставьте пустым, чтобы не менять'), 'https://api.provider.example/sub/BAD');
      await user.click(screen.getByText('Сохранить'));

      expect(await screen.findByText(/нет ссылки, с которой можно поднять туннель/)).toBeTruthy();
    });
  });
});
