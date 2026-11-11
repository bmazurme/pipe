import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { store } from '../../store';
import { vpnApi } from '../../store/api';
import { VpnProfilesCard } from './VpnProfilesCard';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const PROFILES = [
  { id: 1, label: 'iPhone', audience: 'phone', tokenPrefix: 'brp_ab12', createdAt: '2026-11-11T10:00:00.000Z', lastUsedAt: new Date(Date.now() - 120_000).toISOString(), revokedAt: null },
  { id: 2, label: 'Старый Mac', audience: 'laptop', tokenPrefix: 'brp_cd34', createdAt: '2026-10-01T10:00:00.000Z', lastUsedAt: null, revokedAt: '2026-11-01T10:00:00.000Z' },
];

function renderCard() {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <VpnProfilesCard />
      </ThemeProvider>
    </Provider>,
  );
}

type Handler = (request: Request) => Promise<Response | undefined> | Response | undefined;

function serve(extra: Handler = () => undefined, profiles: unknown = PROFILES) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const custom = await extra(request);
      if (custom) return custom;
      if (request.url.endsWith('/vpn/profiles') && request.method === 'GET') return json(profiles);

      return json({});
    }),
  );
}

beforeEach(() => {
  store.dispatch(vpnApi.util.resetApiState());
});

describe('VpnProfilesCard', () => {
  it('lists the devices with their kind, when each last asked, and marks a revoked one', async () => {
    serve();
    renderCard();

    expect(await screen.findByText('iPhone')).toBeTruthy();
    expect(screen.getByText('Телефон', { selector: '.g-label__content, .g-label *' })).toBeTruthy();
    expect(screen.getByText(/последний запрос/)).toBeTruthy();
    expect(screen.getByText('ещё не запрашивалась')).toBeTruthy();
    expect(screen.getByText('отозвана')).toBeTruthy();
    expect(screen.getByText('brp_ab12…')).toBeTruthy();
  });

  it('offers a revoke only for a link that is still valid', async () => {
    serve();
    renderCard();
    await screen.findByText('iPhone');

    expect(screen.getByLabelText('Отозвать ссылку: iPhone')).toBeTruthy();
    expect(screen.queryByLabelText('Отозвать ссылку: Старый Mac')).toBeNull();
  });

  it('says so when there are no links yet', async () => {
    serve(() => undefined, []);
    renderCard();

    expect(await screen.findByText('Ссылок ещё нет — создайте первую ниже.')).toBeTruthy();
  });

  it('makes a link for a device and shows it once, in full, with a warning', async () => {
    const user = userEvent.setup();
    let body: unknown;
    serve(async (request) => {
      if (request.url.endsWith('/vpn/profiles') && request.method === 'POST') {
        body = JSON.parse(await request.clone().text());

        return json({ id: 3, label: 'Pixel', audience: 'phone', tokenPrefix: 'brp_zz99', createdAt: '2026-11-11T12:00:00.000Z', lastUsedAt: null, revokedAt: null, token: 'brp_zz99SECRET', path: '/api/v1/vpn/profile/brp_zz99SECRET' });
      }

      return undefined;
    });
    renderCard();
    await screen.findByText('iPhone');

    expect((screen.getByRole('button', { name: 'Создать ссылку' }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByPlaceholderText('Например, iPhone'), 'Pixel');
    await user.click(screen.getByRole('button', { name: 'Создать ссылку' }));

    await waitFor(() => expect(body).toEqual({ label: 'Pixel', audience: 'phone' }));
    const link = (await screen.findByLabelText('Ссылка профиля Pixel')) as HTMLInputElement;

    expect(link.value).toMatch(/\/api\/v1\/vpn\/profile\/brp_zz99SECRET$/);
    expect(screen.getByText(/больше она не показывается/)).toBeTruthy();
    expect(screen.getByPlaceholderText('Например, iPhone')).toHaveValue('');
  });

  it('sends the kind that was picked', async () => {
    const user = userEvent.setup();
    let body: unknown;
    serve(async (request) => {
      if (request.url.endsWith('/vpn/profiles') && request.method === 'POST') {
        body = JSON.parse(await request.clone().text());

        return json({ ...PROFILES[0], id: 4, token: 'brp_x', path: '/api/v1/vpn/profile/brp_x' });
      }

      return undefined;
    });
    renderCard();
    await screen.findByText('iPhone');

    await user.type(screen.getByPlaceholderText('Например, iPhone'), 'MacBook');
    const kinds = screen.getByRole('radiogroup', { name: 'Тип устройства' });
    await user.click(within(kinds).getByText('Ноутбук'));
    await user.click(screen.getByRole('button', { name: 'Создать ссылку' }));

    await waitFor(() => expect(body).toEqual({ label: 'MacBook', audience: 'laptop' }));
  });

  it('revokes only after a second click, and the armed button is not left armed', async () => {
    const user = userEvent.setup();
    const revoked: string[] = [];
    serve((request) => {
      if (request.method === 'DELETE') {
        revoked.push(request.url.split('/').pop() as string);

        return new Response(null, { status: 204 });
      }

      return undefined;
    });
    renderCard();
    await screen.findByText('iPhone');

    await user.click(screen.getByLabelText('Отозвать ссылку: iPhone'));
    expect(revoked).toEqual([]);
    await user.click(screen.getByLabelText('Подтвердить отзыв ссылки: iPhone'));

    await waitFor(() => expect(revoked).toEqual(['1']));
  });

  it('shows the reason a link could not be made', async () => {
    const user = userEvent.setup();
    serve((request) => (request.url.endsWith('/vpn/profiles') && request.method === 'POST' ? json({ message: 'x' }, 500) : undefined));
    renderCard();
    await screen.findByText('iPhone');

    await user.type(screen.getByPlaceholderText('Например, iPhone'), 'Pixel');
    await user.click(screen.getByRole('button', { name: 'Создать ссылку' }));

    expect(await screen.findByText('Не удалось создать ссылку')).toBeTruthy();
  });

  describe('renaming a device', () => {
    const patches: { url: string; body: unknown }[] = [];
    const serveRename = (reply: () => Response = () => json({ ...PROFILES[0], label: 'x' })) =>
      serve(async (request) => {
        if (request.method !== 'PATCH') return undefined;

        patches.push({ url: request.url, body: await request.clone().json() });

        return reply();
      });

    beforeEach(() => {
      patches.length = 0;
    });

    it('turns the name into a field, and Save sends the trimmed name for that device only', async () => {
      const user = userEvent.setup();
      serveRename();
      renderCard();
      await screen.findByText('iPhone');

      await user.click(screen.getByLabelText('Переименовать: iPhone'));
      const field = screen.getByLabelText('Новое имя устройства iPhone');

      expect(field).toHaveFocus();
      expect(field).toHaveValue('iPhone');
      await user.clear(field);
      await user.type(field, '  Телефон Богдана ');
      await user.click(screen.getByRole('button', { name: 'Сохранить' }));

      await waitFor(() => expect(patches).toHaveLength(1));
      expect(patches[0].url).toMatch(/\/vpn\/profiles\/1$/);
      expect(patches[0].body).toEqual({ label: 'Телефон Богдана' });
      await waitFor(() => expect(screen.queryByLabelText('Новое имя устройства iPhone')).toBeNull());
    });

    it('Enter saves and Escape cancels without a request', async () => {
      const user = userEvent.setup();
      serveRename();
      renderCard();
      await screen.findByText('iPhone');

      await user.click(screen.getByLabelText('Переименовать: iPhone'));
      await user.type(screen.getByLabelText('Новое имя устройства iPhone'), '2{Escape}');

      expect(screen.queryByLabelText('Новое имя устройства iPhone')).toBeNull();
      expect(patches).toHaveLength(0);
      expect(screen.getByText('iPhone')).toBeTruthy();

      await user.click(screen.getByLabelText('Переименовать: iPhone'));
      await user.type(screen.getByLabelText('Новое имя устройства iPhone'), '2{Enter}');

      await waitFor(() => expect(patches).toHaveLength(1));
      expect(patches[0].body).toEqual({ label: 'iPhone2' });
    });

    it('cannot save an empty name, and an unchanged one closes without asking the server', async () => {
      const user = userEvent.setup();
      serveRename();
      renderCard();
      await screen.findByText('iPhone');

      await user.click(screen.getByLabelText('Переименовать: iPhone'));
      await user.clear(screen.getByLabelText('Новое имя устройства iPhone'));
      expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();

      await user.type(screen.getByLabelText('Новое имя устройства iPhone'), ' iPhone ');
      await user.click(screen.getByRole('button', { name: 'Сохранить' }));

      expect(screen.queryByLabelText('Новое имя устройства iPhone')).toBeNull();
      expect(patches).toHaveLength(0);
    });

    it('keeps the field open with what was typed when the server refuses', async () => {
      const user = userEvent.setup();
      serveRename(() => json({ message: 'no' }, 500));
      renderCard();
      await screen.findByText('iPhone');

      await user.click(screen.getByLabelText('Переименовать: iPhone'));
      const field = screen.getByLabelText('Новое имя устройства iPhone');
      await user.clear(field);
      await user.type(field, 'Новое');
      await user.click(screen.getByRole('button', { name: 'Сохранить' }));

      expect(await screen.findByText('Не удалось переименовать')).toBeTruthy();
      expect(screen.getByLabelText('Новое имя устройства iPhone')).toHaveValue('Новое');
    });

    it('offers it for a revoked device too — it is still in the list', async () => {
      serveRename();
      renderCard();
      await screen.findByText('Старый Mac');

      expect(screen.getByLabelText('Переименовать: Старый Mac')).toBeTruthy();
    });
  });
});
