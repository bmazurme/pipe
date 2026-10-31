import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '../../store';
import { workerApi } from '../../store/api';
import { ProviderCredentialsCard } from './ProviderCredentialsCard';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const customKey = {
  id: 9,
  provider: 'custom',
  name: 'Локальная Qwen',
  keyHint: '',
  baseUrl: 'http://192.168.50.35:11434/v1',
  model: 'qwen2.5-coder:7b',
  route: 'direct',
  authScheme: 'none',
  extraHeaderNames: [],
  timeoutSec: 900,
  supportsTools: false,
  stream: false,
  priceInPerMTok: null,
  priceOutPerMTok: null,
  preset: 'ollama',
  allowedWorkerIds: [4],
  createdAt: '2026-10-31T00:00:00Z',
};

let posted: { path: string; body: unknown }[];
let keys: unknown[];

beforeEach(() => {
  posted = [];
  keys = [];
  store.dispatch(workerApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace('/api/v1', '');

      if (request.method === 'POST') {
        posted.push({ path, body: JSON.parse(await request.clone().text()) });

        return json({ ...customKey, id: 10 }, 201);
      }
      if (path === '/workers') {
        return json([
          { id: 4, name: 'mac-fusion', kind: 'managed' },
          { id: 5, name: 'pi-green', kind: 'managed' },
          { id: null, name: 'legacy-box', kind: 'legacy' },
        ]);
      }

      return json(keys);
    }),
  );
});

const renderCard = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <ProviderCredentialsCard />
      </ThemeProvider>
    </Provider>,
  );

async function startCustom(user: ReturnType<typeof userEvent.setup>) {
  renderCard();
  await screen.findByText(/Ключей пока нет/);
  await user.click(screen.getByText('GPT'));
  await user.click(await screen.findByText('Другая модель (свой сервер)'));
}

describe('ProviderCredentialsCard — a custom model', () => {
  it('lists a custom key with how its requests travel, and never a secret', async () => {
    keys = [customKey];
    renderCard();

    expect(await screen.findByText(/Другая модель \(свой сервер\) · Локальная Qwen/)).toBeTruthy();
    expect(screen.getByText('напрямую · без ключа · без вызова функций (только чат) · таймаут 900 с · только worker: 1')).toBeTruthy();
  });

  it('a template fills in the address, authorization and route, and says where the data goes', async () => {
    const user = userEvent.setup();

    await startCustom(user);
    await user.click(screen.getByText('Другой OpenAI-совместимый'));
    await user.click(await screen.findByText('Google Gemini'));

    expect((screen.getByLabelText('Адрес API') as HTMLInputElement).value).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
    expect(screen.getByText(/Содержимое задач и чатов уйдёт:/).textContent).toContain('Google');
    expect(screen.getByText('всегда через VPN worker\'а')).toBeTruthy();
  });

  it('a local server needs no key: Ollama hides the key field, and the form saves once address, model and name are there', async () => {
    const user = userEvent.setup();

    await startCustom(user);
    await user.click(screen.getByText('Другой OpenAI-совместимый'));
    await user.click(await screen.findByText('Ollama (локально)'));

    expect(screen.queryByLabelText('API-ключ')).toBeNull();

    const add = screen.getByRole('button', { name: 'Добавить ключ' });

    expect(add).toBeDisabled();
    await user.type(screen.getByPlaceholderText(/Название ключа/), 'Mac M2');
    await user.type(screen.getByLabelText('Модель'), 'qwen2.5-coder:7b');
    await user.click(add);

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].body).toMatchObject({
      provider: 'custom',
      name: 'Mac M2',
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen2.5-coder:7b',
      authScheme: 'none',
      route: 'direct',
      supportsTools: true,
      preset: 'ollama',
    });
    expect(posted[0].body).not.toHaveProperty('apiKey');
  });

  it('sends the headers, the timeout and the workers the key is limited to; refuses a bad header line', async () => {
    const user = userEvent.setup();

    await startCustom(user);
    await user.click(screen.getByText('Другой OpenAI-совместимый'));
    await user.click(await screen.findByText('Yandex AI Studio'));
    await user.type(screen.getByPlaceholderText(/Название ключа/), 'Yandex');
    await user.type(screen.getByLabelText('Модель'), 'gpt://b1g/yandexgpt');
    await user.type(screen.getByLabelText('API-ключ'), 'AQVN-secret');
    await user.click(screen.getByText(/Дополнительно/));

    const headers = screen.getByLabelText('Заголовки');

    await user.clear(headers);
    await user.type(headers, 'nocolon');
    expect(screen.getByRole('button', { name: 'Добавить ключ' })).toBeDisabled();

    await user.clear(headers);
    await user.type(headers, 'x-folder-id: b1g');
    await user.type(screen.getByLabelText('Таймаут'), '600');
    await user.type(screen.getByLabelText('Цена входа'), '0,5');
    await user.type(screen.getByLabelText('Цена выхода'), '2');
    await user.click(screen.getByText(/Потоковая выдача в чате/));
    await user.click(await screen.findByLabelText('mac-fusion'));
    expect(screen.queryByLabelText('legacy-box')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Добавить ключ' }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].body).toMatchObject({
      provider: 'custom',
      apiKey: 'AQVN-secret',
      authScheme: 'api-key',
      extraHeaders: { 'x-folder-id': 'b1g' },
      timeoutSec: 600,
      priceInPerMTok: 0.5,
      priceOutPerMTok: 2,
      stream: true,
      allowedWorkerIds: [4],
    });
  });

  it('a named provider still needs a key and sends none of the custom fields', async () => {
    const user = userEvent.setup();

    renderCard();
    await screen.findByText(/Ключей пока нет/);
    await user.type(screen.getByPlaceholderText(/Название ключа/), 'рабочий');
    expect(screen.getByRole('button', { name: 'Добавить ключ' })).toBeDisabled();
    await user.type(screen.getByLabelText('API-ключ'), 'sk-1');
    await user.click(screen.getByRole('button', { name: 'Добавить ключ' }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].body).toEqual({ provider: 'gpt', name: 'рабочий', apiKey: 'sk-1' });
    expect(within(document.body).queryByText('Заголовки')).toBeNull();
  });
});
