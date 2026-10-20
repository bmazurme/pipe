import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';

import { store } from '../../store';
import { workerApi } from '../../store/api';
import { WorkersTab } from './WorkersTab';

const NOW = '2026-10-14T12:00:00.000Z';

function fleetWorker(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'green',
    kind: 'managed',
    state: 'idle',
    enabled: true,
    lastSeenAt: new Date().toISOString(),
    activeJobs: 0,
    hostname: 'box',
    version: '1.0.0',
    models: null,
    pollIntervalSec: 10,
    jobTimeoutSec: 1800,
    proxyUrl: null,
    chatEnabled: true,
    keyPrefix: 'brw_AAAAAAAA',
    enrollmentPending: false,
    enrollmentExpiresAt: null,
    createdAt: NOW,
    claudeLimits: null,
    claudeCredentialId: null,
    vpnHost: null,
    limitsRefreshMin: 0,
    limitsRefreshRequestedAt: null,
    ...over,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface Recorded {
  method: string;
  path: string;
  body: unknown;
}

let workers: unknown[];
let requests: Recorded[];
let respond: (request: Recorded) => Response | undefined;

beforeEach(() => {
  workers = [];
  requests = [];
  respond = () => undefined;
  store.dispatch(workerApi.util.resetApiState());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const text = request.method === 'GET' ? '' : await request.clone().text();
      const recorded: Recorded = {
        method: request.method,
        path: new URL(request.url).pathname.replace(/^\/api\/v1/, ''),
        body: text ? JSON.parse(text) : undefined,
      };

      requests.push(recorded);

      const custom = respond(recorded);

      if (custom) return custom;
      if (recorded.method === 'GET' && recorded.path === '/workers') return json(workers);
      if (recorded.method === 'GET' && recorded.path === '/worker/claude-credentials') return json([]);

      return json({});
    }),
  );
});

function renderTab(jobs: unknown[] = []) {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <MemoryRouter>
          <WorkersTab jobs={jobs as never} onOpenJob={vi.fn()} />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );
}

const sent = (method: string, path: string) => requests.filter((r) => r.method === method && r.path === path);

describe('WorkersTab — empty', () => {
  it('invites the owner to add the first worker, and says what that takes', async () => {
    renderTab();

    expect(await screen.findByText("Worker'ов ещё нет")).toBeTruthy();
    expect(screen.getByText(/одноразовый код и одна команда/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Добавить worker/ }).length).toBeGreaterThan(0);
  });
});

describe('WorkersTab — adding a worker', () => {
  it('names it, gets a one-time code and a ready command — and is never asked for a secret', async () => {
    const user = userEvent.setup();

    respond = (r) =>
      r.method === 'POST' && r.path === '/workers'
        ? json(
            {
              worker: fleetWorker({
                id: 7,
                name: 'laptop',
                state: 'pending',
                lastSeenAt: null,
                keyPrefix: null,
                enrollmentPending: true,
              }),
              enrollCode: 'brn_ONE-TIME-CODE',
              enrollExpiresAt: new Date(Date.now() + 29 * 60_000).toISOString(),
            },
            201,
          )
        : undefined;
    renderTab();

    await user.click((await screen.findAllByRole('button', { name: /Добавить worker/ }))[0]);
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).queryByPlaceholderText(/ключ|токен|key|token/i)).toBeNull();

    await user.type(within(dialog).getByPlaceholderText(/Например, green/), 'laptop');
    await user.click(within(dialog).getByRole('button', { name: 'Создать и получить код' }));

    expect(await within(dialog).findByText('brn_ONE-TIME-CODE')).toBeTruthy();
    expect(sent('POST', '/workers')[0].body).toEqual({ name: 'laptop' });

    const command = within(dialog).getByLabelText('Команда подключения');

    expect(command.textContent).toContain('WORKER_ENROLL_CODE=brn_ONE-TIME-CODE');
    expect(command.textContent).toContain('BRIDGE_API_URL=');
    expect(command.textContent).not.toMatch(/API_KEY|brk_|TOKEN/);
    expect(within(dialog).getByText(/ещё ~\d+ мин/)).toBeTruthy();
    expect(within(dialog).getByText(/Ждём, пока worker подключится/)).toBeTruthy();
  });

  it('takes the token and the VPN already when the worker is added, and the command is for that worker only', async () => {
    const user = userEvent.setup();

    respond = (r) => {
      if (r.method === 'GET' && r.path === '/worker/claude-credentials') {
        return json([{ id: 5, name: 'personal', createdAt: NOW, limits: null }]);
      }

      return r.method === 'POST' && r.path === '/workers'
        ? json(
            {
              worker: fleetWorker({ id: 7, name: 'green', state: 'pending', lastSeenAt: null, vpnHost: 'vpn.example.com:443' }),
              enrollCode: 'brn_Y',
              enrollExpiresAt: new Date(Date.now() + 29 * 60_000).toISOString(),
            },
            201,
          )
        : undefined;
    };
    renderTab();

    await user.click((await screen.findAllByRole('button', { name: /Добавить worker/ }))[0]);
    const dialog = await screen.findByRole('dialog');

    await user.type(within(dialog).getByPlaceholderText(/Например, green/), 'green');
    await user.click(within(dialog).getByText('Первый из списка токенов'));
    await user.click(await screen.findByText('personal'));
    await user.type(within(dialog).getByLabelText("VPN-ссылка worker'а"), 'vless://u@vpn.example.com:443?security=reality&pbk=k&sni=s');
    await user.click(within(dialog).getByRole('button', { name: 'Создать и получить код' }));
    await within(dialog).findByText('brn_Y');

    expect(sent('POST', '/workers')[0].body).toEqual({
      name: 'green',
      claudeCredentialId: 5,
      vpnLink: 'vless://u@vpn.example.com:443?security=reality&pbk=k&sni=s',
    });

    const command = within(dialog).getByLabelText('Команда подключения').textContent ?? '';

    expect(command).toContain('--name pipe-worker-green');
    expect(command).toContain('-v pipe-worker-green-state:/app/.worker-state');
    // the secrets travel through the page, never through the command
    expect(command).not.toContain('vless://');
  });

  it('will not create a worker with a VPN link that is not vless://', async () => {
    const user = userEvent.setup();

    renderTab();

    await user.click((await screen.findAllByRole('button', { name: /Добавить worker/ }))[0]);
    const dialog = await screen.findByRole('dialog');

    await user.type(within(dialog).getByPlaceholderText(/Например, green/), 'green');
    await user.type(within(dialog).getByLabelText("VPN-ссылка worker'а"), 'http://not-a-vpn');

    expect(within(dialog).getByText('Нужна ссылка vless://… (Reality)')).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Создать и получить код' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers the other ways to hand over the code', async () => {
    const user = userEvent.setup();

    respond = (r) =>
      r.method === 'POST' && r.path === '/workers'
        ? json(
            {
              worker: fleetWorker({
                id: 7,
                name: 'laptop',
                state: 'pending',
                lastSeenAt: null,
              }),
              enrollCode: 'brn_X',
              enrollExpiresAt: new Date(Date.now() + 29 * 60_000).toISOString(),
            },
            201,
          )
        : undefined;
    renderTab();

    await user.click((await screen.findAllByRole('button', { name: /Добавить worker/ }))[0]);
    const dialog = await screen.findByRole('dialog');

    await user.type(within(dialog).getByPlaceholderText(/Например, green/), 'laptop');
    await user.click(within(dialog).getByRole('button', { name: 'Создать и получить код' }));
    await within(dialog).findByText('brn_X');

    await user.click(within(dialog).getByText('Уже запущен'));

    expect(within(dialog).getByLabelText('Команда подключения').textContent).toBe(
      'echo brn_X | docker exec -i pipe-worker-laptop node dist/enrollCli.js -',
    );
  });

  it('turns into "connected" by itself the moment the worker redeems the code', async () => {
    const user = userEvent.setup();
    let connected = false;

    respond = (r) => {
      if (r.method === 'POST' && r.path === '/workers') {
        return json(
          {
            worker: fleetWorker({
              id: 7,
              name: 'laptop',
              state: 'pending',
              lastSeenAt: null,
            }),
            enrollCode: 'brn_Y',
            enrollExpiresAt: new Date(Date.now() + 29 * 60_000).toISOString(),
          },
          201,
        );
      }
      if (r.method === 'GET' && r.path === '/workers') {
        return json(
          connected
            ? [fleetWorker({ id: 7, name: 'laptop', state: 'idle' })]
            : [
                fleetWorker({
                  id: 7,
                  name: 'laptop',
                  state: 'pending',
                  lastSeenAt: null,
                }),
              ],
        );
      }

      return undefined;
    };
    renderTab();

    await user.click((await screen.findAllByRole('button', { name: /Добавить worker/ }))[0]);
    const dialog = await screen.findByRole('dialog');

    await user.type(within(dialog).getByPlaceholderText(/Например, green/), 'laptop');
    await user.click(within(dialog).getByRole('button', { name: 'Создать и получить код' }));
    await within(dialog).findByText('brn_Y');

    connected = true;

    expect(await within(dialog).findByText('«laptop» подключён', {}, { timeout: 6000 })).toBeTruthy();
  }, 15_000);

  it('shows the server’s reason when the name is taken', async () => {
    const user = userEvent.setup();

    respond = (r) =>
      r.method === 'POST' && r.path === '/workers'
        ? json({ message: 'A worker named "x" already exists' }, 409)
        : undefined;
    renderTab();

    await user.click((await screen.findAllByRole('button', { name: /Добавить worker/ }))[0]);
    const dialog = await screen.findByRole('dialog');

    await user.type(within(dialog).getByPlaceholderText(/Например, green/), 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Создать и получить код' }));

    expect(await within(dialog).findByText(/already exists/)).toBeTruthy();
  });

  it('will not create a worker without a name', async () => {
    const user = userEvent.setup();

    renderTab();
    await user.click((await screen.findAllByRole('button', { name: /Добавить worker/ }))[0]);
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByRole('button', { name: 'Создать и получить код' })).toBeDisabled();
  });
});

describe('WorkersTab — the list', () => {
  it('shows each worker with its state, where it runs and what it may do', async () => {
    workers = [
      fleetWorker({
        id: 1,
        name: 'green',
        state: 'idle',
        models: ['gpt', 'qwen'],
        proxyUrl: 'http://vpn:1080',
        chatEnabled: false,
      }),
      fleetWorker({
        id: 2,
        name: 'blue',
        state: 'offline',
        hostname: 'blue-host',
      }),
    ];
    renderTab();

    expect(await screen.findByText('green')).toBeTruthy();
    expect(screen.getByText('Свободен')).toBeTruthy();
    expect(screen.getByText('Не на связи')).toBeTruthy();
    expect(screen.getByText(/Модели: GPT, Qwen/)).toBeTruthy();
    expect(screen.getByText(/Прокси: http:\/\/vpn:1080/)).toBeTruthy();
    expect(screen.getByText('Чат выключен')).toBeTruthy();
    expect(screen.getByText(/blue-host/)).toBeTruthy();
  });

  it('names the job a busy worker is running', async () => {
    workers = [fleetWorker({ id: 1, state: 'busy', activeJobs: 1 })];
    renderTab([
      {
        id: 12,
        model: 'sonnet',
        status: 'running',
        workerId: 1,
        workerName: 'green',
      },
    ]);

    expect(await screen.findByText('Занят')).toBeTruthy();
    expect(screen.getByRole('button', { name: /задача #12 · Claude Sonnet/ })).toBeTruthy();
  });

  it('pauses and resumes a worker with its switch', async () => {
    const user = userEvent.setup();

    workers = [fleetWorker({ id: 1 })];
    renderTab();

    await user.click(await screen.findByRole('switch', { name: 'green: берёт задачи' }));

    await waitFor(() => expect(sent('PATCH', '/workers/1')).toHaveLength(1));
    expect(sent('PATCH', '/workers/1')[0].body).toEqual({ enabled: false });
  });

  it('has no switch for a worker that is not connected yet — it is offered its code instead', async () => {
    workers = [
      fleetWorker({
        id: 3,
        name: 'new',
        state: 'pending',
        lastSeenAt: null,
        enrollmentPending: true,
      }),
    ];
    renderTab();

    expect(await screen.findByText('Ждёт подключения')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByRole('button', { name: /Показать код/ })).toBeTruthy();
    expect(screen.getByText(/запустите команду из подсказки/)).toBeTruthy();
  });

  it('says when the code has expired', async () => {
    workers = [
      fleetWorker({
        id: 3,
        name: 'late',
        state: 'pending',
        lastSeenAt: null,
        enrollmentPending: false,
      }),
    ];
    renderTab();

    expect(await screen.findByText(/Код подключения истёк/)).toBeTruthy();
  });

  it('marks a worker that still uses an API key from the environment, and offers to hide it', async () => {
    const user = userEvent.setup();

    workers = [
      fleetWorker({
        id: null,
        name: 'old-green',
        kind: 'legacy',
        keyPrefix: null,
      }),
    ];
    renderTab();

    expect(await screen.findByText('old-green')).toBeTruthy();
    expect(screen.getByText('переменные среды')).toBeTruthy();
    expect(screen.getByText(/не берёт закреплённые задачи/)).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Скрыть' }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Скрыть' }));

    await waitFor(() => expect(sent('DELETE', '/workers/legacy/old-green')).toHaveLength(1));
  });
});

describe('WorkersTab — settings', () => {
  it('shows the current settings and saves changes in the units the server wants', async () => {
    const user = userEvent.setup();

    workers = [
      fleetWorker({
        id: 1,
        jobTimeoutSec: 1800,
        pollIntervalSec: 10,
        models: null,
      }),
    ];
    renderTab();

    await user.click(await screen.findByRole('button', { name: /Настройки/ }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByDisplayValue('green')).toBeTruthy();
    expect(within(dialog).getByDisplayValue('30')).toBeTruthy();

    const nameField = within(dialog).getByDisplayValue('green');

    await user.clear(nameField);
    await user.type(nameField, 'green-2');
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sent('PATCH', '/workers/1')).toHaveLength(1));

    const body = sent('PATCH', '/workers/1')[0].body as Record<string, unknown>;

    expect(body).toMatchObject({
      name: 'green-2',
      jobTimeoutSec: 1800,
      pollIntervalSec: 10,
      models: null,
      chatEnabled: true,
    });
    expect(body.proxyUrl).toBeNull();
  });

  it('binds the worker to one of the Claude tokens, or back to the first one', async () => {
    const user = userEvent.setup();

    respond = (request) =>
      request.method === 'GET' && request.path === '/worker/claude-credentials'
        ? json([
            { id: 5, name: 'personal', createdAt: NOW, limits: null },
            { id: 6, name: 'team', createdAt: NOW, limits: null },
          ])
        : undefined;
    workers = [fleetWorker({ id: 1, claudeCredentialId: 5 })];
    renderTab();

    await user.click(await screen.findByRole('button', { name: /Настройки/ }));
    const dialog = await screen.findByRole('dialog');

    // The current binding is shown by its name.
    expect(await within(dialog).findByText('personal')).toBeTruthy();

    await user.click(within(dialog).getByText('personal'));
    await user.click(await screen.findByText('team'));
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sent('PATCH', '/workers/1')).toHaveLength(1));
    expect(sent('PATCH', '/workers/1')[0].body).toMatchObject({ claudeCredentialId: 6 });
  });

  it('saves "the first token" as null when no token is set for the worker', async () => {
    const user = userEvent.setup();

    workers = [fleetWorker({ id: 1, claudeCredentialId: null })];
    renderTab();

    await user.click(await screen.findByRole('button', { name: /Настройки/ }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByText('Первый из списка токенов')).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sent('PATCH', '/workers/1')).toHaveLength(1));
    expect(sent('PATCH', '/workers/1')[0].body).toMatchObject({ claudeCredentialId: null });
  });

  describe('the worker VPN', () => {
    const LINK = 'vless://u@new.example.com:443?security=reality&pbk=k&sni=s';

    it('shows only the host of the VPN that is set, and replaces it with a new link', async () => {
      const user = userEvent.setup();

      workers = [fleetWorker({ id: 1, vpnHost: 'vpn.example.com:8443' })];
      renderTab();

      await user.click(await screen.findByRole('button', { name: /Настройки/ }));
      const dialog = await screen.findByRole('dialog');

      expect(within(dialog).getByText('Настроен: vpn.example.com:8443')).toBeTruthy();
      expect(within(dialog).queryByLabelText("VPN-ссылка worker'а")).toBeNull();

      await user.click(within(dialog).getByRole('button', { name: 'Заменить' }));
      await user.type(within(dialog).getByLabelText("VPN-ссылка worker'а"), LINK);
      await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

      await waitFor(() => expect(sent('PATCH', '/workers/1')).toHaveLength(1));
      expect(sent('PATCH', '/workers/1')[0].body).toMatchObject({ vpnLink: LINK });
    });

    it('removes it, and can take that back', async () => {
      const user = userEvent.setup();

      workers = [fleetWorker({ id: 1, vpnHost: 'vpn.example.com:8443' })];
      renderTab();

      await user.click(await screen.findByRole('button', { name: /Настройки/ }));
      const dialog = await screen.findByRole('dialog');

      await user.click(within(dialog).getByRole('button', { name: 'Убрать' }));
      expect(within(dialog).getByText('VPN будет удалён')).toBeTruthy();
      await user.click(within(dialog).getByRole('button', { name: 'Не удалять' }));
      expect(within(dialog).getByText('Настроен: vpn.example.com:8443')).toBeTruthy();

      await user.click(within(dialog).getByRole('button', { name: 'Убрать' }));
      await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

      await waitFor(() => expect(sent('PATCH', '/workers/1')).toHaveLength(1));
      expect(sent('PATCH', '/workers/1')[0].body).toMatchObject({ vpnLink: null });
    });

    it('leaves the VPN alone (sends nothing about it) when it was not touched', async () => {
      const user = userEvent.setup();

      workers = [fleetWorker({ id: 1, vpnHost: 'vpn.example.com:8443' })];
      renderTab();

      await user.click(await screen.findByRole('button', { name: /Настройки/ }));
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Сохранить' }));

      await waitFor(() => expect(sent('PATCH', '/workers/1')).toHaveLength(1));
      expect(sent('PATCH', '/workers/1')[0].body).not.toHaveProperty('vpnLink');
    });

    it('a worker without a VPN gets the link field straight away, and the card shows the host when there is one', async () => {
      const user = userEvent.setup();

      workers = [fleetWorker({ id: 1, vpnHost: null })];
      renderTab();

      await user.click(await screen.findByRole('button', { name: /Настройки/ }));
      expect(within(await screen.findByRole('dialog')).getByLabelText("VPN-ссылка worker'а")).toBeTruthy();
    });

    it('the card shows which VPN server the worker uses', async () => {
      workers = [fleetWorker({ id: 1, vpnHost: 'vpn.example.com:8443' })];
      renderTab();

      expect(await screen.findByText('VPN: vpn.example.com:8443')).toBeTruthy();
    });
  });

  it('chooses how often the worker refreshes its Claude limits by itself, off by default', async () => {
    const user = userEvent.setup();

    workers = [fleetWorker({ id: 1, limitsRefreshMin: 0 })];
    renderTab();

    await user.click(await screen.findByRole('button', { name: /Настройки/ }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByText('Выключено — по кнопке и после запусков'));
    await user.click(await screen.findByText('Каждые 30 минут'));
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sent('PATCH', '/workers/1')).toHaveLength(1));
    expect(sent('PATCH', '/workers/1')[0].body).toMatchObject({ limitsRefreshMin: 30 });
  });

  it('restricting the models sends exactly those', async () => {
    const user = userEvent.setup();

    workers = [fleetWorker({ id: 1 })];
    renderTab();

    await user.click(await screen.findByRole('button', { name: /Настройки/ }));
    const dialog = await screen.findByRole('dialog');

    for (const label of ['Claude Sonnet', 'Claude Opus', 'Claude Haiku', 'DeepSeek', 'Qwen']) {
      await user.click(within(dialog).getByLabelText(label));
    }
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(sent('PATCH', '/workers/1')).toHaveLength(1));
    expect(sent('PATCH', '/workers/1')[0].body).toMatchObject({
      models: ['gpt'],
    });
  });

  it('will not save with no model at all, or a proxy that is not http(s)', async () => {
    const user = userEvent.setup();

    workers = [fleetWorker({ id: 1, models: ['gpt'] })];
    renderTab();

    await user.click(await screen.findByRole('button', { name: /Настройки/ }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByLabelText('GPT'));
    expect(within(dialog).getByText('Выберите хотя бы одну модель.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Сохранить' })).toBeDisabled();

    await user.click(within(dialog).getByLabelText('GPT'));
    await user.type(within(dialog).getByPlaceholderText('http://vpn-client:1080'), 'socks5://x');

    expect(within(dialog).getByText(/SOCKS не поддерживается/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });
});

describe('WorkersTab — reconnecting and deleting', () => {
  it('reconnecting issues a new code (the old key stops working) and shows it', async () => {
    const user = userEvent.setup();

    workers = [fleetWorker({ id: 1 })];
    respond = (r) => {
      if (r.method === 'POST' && r.path === '/workers/1/enroll-code') {
        // the old key is revoked: the worker is "pending" again until it redeems the new code
        workers = [fleetWorker({ id: 1, state: 'pending', lastSeenAt: null })];

        return json(
          {
            worker: workers[0],
            enrollCode: 'brn_AGAIN',
            enrollExpiresAt: new Date(Date.now() + 29 * 60_000).toISOString(),
          },
          201,
        );
      }

      return undefined;
    };
    renderTab();

    await user.click(await screen.findByRole('button', { name: /Подключить заново/ }));

    expect(await screen.findByText('brn_AGAIN')).toBeTruthy();
    expect(sent('POST', '/workers/1/enroll-code')).toHaveLength(1);
  });

  it('asks before deleting, says what will happen, then deletes', async () => {
    const user = userEvent.setup();

    workers = [fleetWorker({ id: 1, state: 'busy', activeJobs: 1 })];
    respond = (r) => (r.method === 'DELETE' && r.path === '/workers/1' ? json({ failedJobs: 1 }) : undefined);
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'Удалить worker: green' }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByText(/Ключ worker'а перестанет действовать сразу/)).toBeTruthy();
    expect(within(dialog).getByText(/Сейчас он выполняет задачу/)).toBeTruthy();
    expect(within(dialog).getByText(/закреплённые за этим worker'ом/i)).toBeTruthy();
    expect(sent('DELETE', '/workers/1')).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(sent('DELETE', '/workers/1')).toHaveLength(1));
  });

  it('cancelling the confirmation deletes nothing', async () => {
    const user = userEvent.setup();

    workers = [fleetWorker({ id: 1 })];
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'Удалить worker: green' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Отмена',
      }),
    );

    expect(sent('DELETE', '/workers/1')).toHaveLength(0);
  });
});
