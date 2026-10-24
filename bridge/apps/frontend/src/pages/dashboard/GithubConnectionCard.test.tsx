import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GithubConnectionCard, verdict } from './GithubConnectionCard';
import { store } from '../../store';
import { dashboardApi } from '../../store/api';

type Sent = { method: string; path: string; body: unknown };
let sent: Sent[];
let state: { enabled: boolean; url: string; source: string };
let checkResult: unknown;
let failSave: string | null;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const sample = (ms: number, ok = true) => ({ ok, ms, status: ok ? 200 : null, error: ok ? null : 'The operation was aborted due to timeout' });

beforeEach(() => {
  sent = [];
  state = { enabled: false, url: 'http://vpn-client:1080', source: 'default' };
  checkResult = { url: 'http://vpn-client:1080', direct: [sample(11300), sample(56)], proxy: [sample(269), sample(229)] };
  failSave = null;
  store.dispatch(dashboardApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1/', '');

      if (request.method === 'GET' && path === 'dashboard/github-connection') return json(state);

      sent.push({ method: request.method, path, body: await request.json().catch(() => undefined) });

      if (path === 'dashboard/github-connection' && request.method === 'PUT') {
        if (failSave) return json({ message: failSave }, 400);
        const body = sent[sent.length - 1].body as { enabled: boolean; url?: string };

        state = { enabled: body.enabled, url: body.url ?? state.url, source: 'setting' };

        return json(state);
      }
      if (path === 'dashboard/github-connection/check') return json(checkResult);

      return json({});
    }),
  );
});

const renderCard = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <GithubConnectionCard />
      </ThemeProvider>
    </Provider>,
  );

describe('GithubConnectionCard', () => {
  it('says how GitHub is reached now and where that was decided', async () => {
    renderCard();

    expect(await screen.findByText('напрямую')).toBeTruthy();
    expect(screen.getByText('по умолчанию')).toBeTruthy();
    expect(screen.getByLabelText('Адрес прокси')).toHaveValue('http://vpn-client:1080');

    state = { enabled: true, url: 'http://env:3128', source: 'environment' };
    store.dispatch(dashboardApi.util.invalidateTags(['GithubConnection']));

    expect(await screen.findByText('через прокси')).toBeTruthy();
    expect(screen.getByText(/задано в окружении стека/)).toBeTruthy();
  });

  it('switches the proxy on from the interface, with the address as it is typed', async () => {
    const user = userEvent.setup();
    renderCard();

    await screen.findByText('напрямую');
    await user.click(screen.getByRole('switch'));

    await waitFor(() => expect(sent).toContainEqual({ method: 'PUT', path: 'dashboard/github-connection', body: { enabled: true, url: 'http://vpn-client:1080' } }));
    expect(await screen.findByText('через прокси')).toBeTruthy();
    expect(screen.getByText('выбрано здесь')).toBeTruthy();
  });

  it('offers to save a changed address, and only then', async () => {
    const user = userEvent.setup();
    renderCard();

    await screen.findByText('напрямую');
    expect(screen.queryByRole('button', { name: 'Сохранить адрес' })).toBeNull();

    const input = screen.getByLabelText('Адрес прокси');

    await user.clear(input);
    await user.type(input, 'http://other:3128');
    await user.click(await screen.findByRole('button', { name: 'Сохранить адрес' }));

    await waitFor(() => expect(sent).toContainEqual({ method: 'PUT', path: 'dashboard/github-connection', body: { enabled: false, url: 'http://other:3128' } }));
  });

  it('shows the refusal of the server when the address is not accepted', async () => {
    const user = userEvent.setup();
    failSave = 'Адрес прокси должен быть вида http://host:порт';
    renderCard();

    await screen.findByText('напрямую');
    await user.click(screen.getByRole('switch'));

    expect(await screen.findByText('Адрес прокси должен быть вида http://host:порт')).toBeTruthy();
  });

  it('times the connection directly and through the proxy and says what to do', async () => {
    const user = userEvent.setup();
    renderCard();

    await screen.findByText('напрямую');
    await user.click(screen.getByRole('button', { name: 'Проверить связь' }));

    expect(await screen.findByText(/Напрямую: 11\.3 с · 56 мс/)).toBeTruthy();
    expect(screen.getByText(/Через прокси: 269 мс · 229 мс/)).toBeTruthy();
    expect(screen.getByText(/прокси лучше включить/)).toBeTruthy();
    expect(sent).toContainEqual({ method: 'POST', path: 'dashboard/github-connection/check', body: { url: 'http://vpn-client:1080' } });
  });
});

describe('verdict', () => {
  it('advises the proxy when the direct way is slow or fails and the proxy answers', () => {
    expect(verdict({ url: 'u', direct: [sample(100), sample(0, false)], proxy: [sample(200), sample(210)] }).theme).toBe('warning');
    expect(verdict({ url: 'u', direct: [sample(4000)], proxy: [sample(200)] }).theme).toBe('warning');
  });

  it('says the proxy is not needed when GitHub is fast directly', () => {
    expect(verdict({ url: 'u', direct: [sample(80), sample(60)], proxy: [sample(250)] }).theme).toBe('success');
  });

  it('warns when the proxy itself does not answer', () => {
    expect(verdict({ url: 'u', direct: [sample(11000)], proxy: [sample(0, false)] }).theme).toBe('danger');
    expect(verdict({ url: 'u', direct: [sample(80)], proxy: null }).theme).toBe('danger');
  });
});
