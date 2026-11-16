import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider, Toaster, ToasterProvider } from '@gravity-ui/uikit';
import type { SettingsType } from '@reports/shared';

import { store, setSettings, initialStateSettings } from '../../store';
import Settings from './index';
import EncryptionSection from './encryption-section';
import TrackedProjectsSection from './tracked-projects-section';

const unwrap = vi.fn().mockResolvedValue({
  gitlabUrl: 'https://gitlab.example.com/api/v4',
  privateToken: 'secret',
  userId: '1',
  employee: 'Иван Иванов',
  company: 'ACME',
});
const setSettingsRequest = vi.fn((settings: SettingsType) => {
  void settings;
  return { unwrap };
});

const generateUnwrap = vi.fn().mockResolvedValue({});
const generateKeyPair = vi.fn(() => ({ unwrap: generateUnwrap }));
const addUnwrap = vi.fn();
const addTrackedProject = vi.fn((project: object) => {
  void project;
  return { unwrap: addUnwrap };
});
let subscriptionConfig: { encryption: { enabled: boolean; publicKey: string; privateKey: string } } | undefined;

const checkUnwrap = vi.fn();
const checkConnection = vi.fn((arg: { target: string; settings: SettingsType }) => {
  void arg;
  return { unwrap: checkUnwrap };
});

vi.mock('../../store/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSetSettingsMutation: () => [setSettingsRequest, { isLoading: false }],
  useCheckConnectionMutation: () => [checkConnection, { isLoading: false }],
  useGetSubscriptionConfigQuery: () => ({ data: subscriptionConfig }),
  useAddTrackedProjectMutation: () => [addTrackedProject, { isLoading: false }],
  useGenerateEncryptionKeyPairMutation: () => [generateKeyPair, { isLoading: false }],
}));

const renderSettings = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <ToasterProvider toaster={new Toaster()}>
          <Settings />
        </ToasterProvider>
      </ThemeProvider>
    </Provider>,
  );

describe('Settings page', () => {
  beforeEach(() => {
    setSettingsRequest.mockClear();
    unwrap.mockClear();
    localStorage.clear();
  });

  it('groups GitLab URL/token separately from the report fields', () => {
    renderSettings();

    const gitlabUrlGroup = screen.getByLabelText('GitLab URL').closest('div');
    const privateTokenGroup = screen.getByLabelText('Токен доступа').closest('div');
    const userIdGroup = screen.getByLabelText('ID пользователя').closest('div');

    expect(gitlabUrlGroup).toBe(privateTokenGroup);
    expect(gitlabUrlGroup).not.toBe(userIdGroup);
  });

  it('keeps Save disabled until something changes', () => {
    renderSettings();

    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });

  it('submits the form to the backend on save', async () => {
    renderSettings();

    await userEvent.type(screen.getByLabelText('GitLab URL'), 'https://gitlab.example.com/api/v4');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(setSettingsRequest).toHaveBeenCalledTimes(1);
    expect(setSettingsRequest.mock.calls[0][0]).toMatchObject({
      gitlabUrl: 'https://gitlab.example.com/api/v4',
    });
  });
});

describe('Settings: connection checks', () => {
  beforeEach(() => {
    // The store is a module singleton: an earlier test's save must not prefill this one's form.
    store.dispatch(setSettings({ ...initialStateSettings, gitlabUrl: '', privateToken: '', bridgeApiUrl: '' }));
    setSettingsRequest.mockClear();
    checkConnection.mockClear();
    checkUnwrap.mockReset();
    localStorage.clear();
  });

  const result = (target: string, items: { label: string; status: string; message: string }[], status = 'ok') => ({
    target, status, items, ms: 12,
  });

  it('disables the GitLab check until URL and token are typed', async () => {
    renderSettings();

    const button = screen.getByRole('button', { name: 'Проверить соединение: GitLab' });
    expect(button).toBeDisabled();

    await userEvent.type(screen.getByLabelText('GitLab URL'), 'https://gitlab.example.com/api/v4');
    await userEvent.type(screen.getByLabelText('Токен доступа'), 'glpat-x');

    expect(button).toBeEnabled();
  });

  it('sends the unsaved form values and shows every item of the answer', async () => {
    checkUnwrap.mockResolvedValue(result('gitlab', [
      { label: 'GitLab', status: 'ok', message: 'Подключено как @ivan, 120 мс' },
      { label: 'ID пользователя', status: 'warn', message: 'В настройках 5, а токен принадлежит 7' },
    ], 'warn'));
    renderSettings();

    await userEvent.type(screen.getByLabelText('GitLab URL'), 'https://gitlab.example.com/api/v4');
    await userEvent.type(screen.getByLabelText('Токен доступа'), 'glpat-x');
    await userEvent.click(screen.getByRole('button', { name: 'Проверить соединение: GitLab' }));

    expect(await screen.findByText('Подключено как @ivan, 120 мс')).toBeInTheDocument();
    expect(screen.getByText('В настройках 5, а токен принадлежит 7')).toBeInTheDocument();
    expect(checkConnection).toHaveBeenCalledTimes(1);
    expect(checkConnection.mock.calls[0][0]).toMatchObject({
      target: 'gitlab',
      settings: { gitlabUrl: 'https://gitlab.example.com/api/v4', privateToken: 'glpat-x' },
    });
    expect(setSettingsRequest).not.toHaveBeenCalled();
  });

  it('hides a result once the values it was obtained with change', async () => {
    checkUnwrap.mockResolvedValue(result('gitlab', [{ label: 'GitLab', status: 'ok', message: 'Подключено как @ivan' }]));
    renderSettings();

    await userEvent.type(screen.getByLabelText('GitLab URL'), 'https://gitlab.example.com/api/v4');
    await userEvent.type(screen.getByLabelText('Токен доступа'), 'glpat-x');
    await userEvent.click(screen.getByRole('button', { name: 'Проверить соединение: GitLab' }));
    await screen.findByText('Подключено как @ivan');

    await userEvent.type(screen.getByLabelText('Токен доступа'), 'y');

    expect(screen.queryByText('Подключено как @ivan')).not.toBeInTheDocument();
    expect(screen.getByText(/Значения изменились после проверки/)).toBeInTheDocument();
  });

  it('shows a transport failure as an error line', async () => {
    checkUnwrap.mockRejectedValue(new Error('Сервер reports не отвечает'));
    renderSettings();

    await userEvent.click(screen.getByRole('button', { name: 'Проверить соединение: GitHub' }));

    expect(await screen.findByText(/Сервер reports не отвечает/)).toBeInTheDocument();
  });

  it('runs all three checks from the header button', async () => {
    checkUnwrap.mockImplementation(() => Promise.resolve(result('x', [{ label: 'Ок', status: 'ok', message: 'готово' }])));
    renderSettings();

    await userEvent.click(screen.getByRole('button', { name: 'Проверить все соединения' }));

    await waitFor(() => expect(checkConnection).toHaveBeenCalledTimes(3));
    expect(checkConnection.mock.calls.map((c) => c[0].target).sort()).toEqual(['bridge', 'github', 'gitlab']);
  });

  it('flags a malformed address and blocks Save until it is fixed', async () => {
    renderSettings();

    await userEvent.type(screen.getByLabelText('GitLab URL'), 'gitlab.example.com');

    expect(screen.getByText(/не похоже на адрес/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();

    await userEvent.clear(screen.getByLabelText('GitLab URL'));
    await userEvent.type(screen.getByLabelText('GitLab URL'), 'https://gitlab.example.com/api/v4');

    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled();
  });

  it('hints at /api/v4 when the address lacks it', async () => {
    renderSettings();

    await userEvent.type(screen.getByLabelText('GitLab URL'), 'https://gitlab.example.com');

    expect(screen.getByText('Обычно адрес заканчивается на /api/v4')).toBeInTheDocument();
  });

  it('saves on Ctrl+S', async () => {
    renderSettings();

    await userEvent.type(screen.getByLabelText('GitLab URL'), 'https://gitlab.example.com/api/v4');
    await userEvent.keyboard('{Control>}s{/Control}');

    await waitFor(() => expect(setSettingsRequest).toHaveBeenCalledTimes(1));
  });

  it('reveals a secret with its own toggle', async () => {
    renderSettings();

    const token = screen.getByLabelText('Токен доступа');
    expect(token).toHaveAttribute('type', 'password');

    await userEvent.click(screen.getByRole('button', { name: 'Показать токен' }));

    expect(token).toHaveAttribute('type', 'text');
  });
});

const renderEncryption = () =>
  render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <ToasterProvider toaster={new Toaster()}>
          <EncryptionSection />
        </ToasterProvider>
      </ThemeProvider>
    </Provider>,
  );

describe('Settings page: encryption keys', () => {
  const existingKeys = { encryption: { enabled: true, publicKey: 'pub', privateKey: 'priv' } };

  beforeEach(() => {
    generateKeyPair.mockClear();
    localStorage.clear();
  });

  it('labels both key textareas', () => {
    subscriptionConfig = existingKeys;
    renderEncryption();

    expect(screen.getByLabelText(/Публичный ключ/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Приватный ключ/)).toBeInTheDocument();
  });

  it('asks for confirmation before replacing existing keys', async () => {
    subscriptionConfig = existingKeys;
    renderEncryption();

    await userEvent.click(screen.getByRole('button', { name: /Сгенерировать пару ключей/ }));

    expect(generateKeyPair).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Заменить' }));

    expect(generateKeyPair).toHaveBeenCalledTimes(1);
  });

  it('leaves the keys alone when the confirmation is cancelled', async () => {
    subscriptionConfig = existingKeys;
    renderEncryption();

    await userEvent.click(screen.getByRole('button', { name: /Сгенерировать пару ключей/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Отмена' }));

    expect(generateKeyPair).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Публичный ключ/)).toHaveValue('pub');
  });

  it('generates in one click when there are no keys yet', async () => {
    subscriptionConfig = { encryption: { enabled: false, publicKey: '', privateKey: '' } };
    renderEncryption();

    await userEvent.click(screen.getByRole('button', { name: /Сгенерировать пару ключей/ }));

    expect(generateKeyPair).toHaveBeenCalledTimes(1);
  });
});

describe('Settings page: tracked repositories dialog', () => {
  const openDialog = async () => {
    subscriptionConfig = { encryption: { enabled: false, publicKey: '', privateKey: '' }, trackedProjects: [] } as never;
    render(
      <Provider store={store}>
        <ThemeProvider theme="light">
          <ToasterProvider toaster={new Toaster()}>
            <TrackedProjectsSection />
          </ToasterProvider>
        </ThemeProvider>
      </Provider>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Добавить репозиторий/ }));
  };
  const fill = async (repo: string) => {
    await userEvent.type(screen.getByLabelText('или GitHub репозиторий'), repo);
    await userEvent.type(screen.getByLabelText('Локальный путь'), '/tmp/repo');
  };

  beforeEach(() => {
    addTrackedProject.mockClear();
    addUnwrap.mockReset();
    localStorage.clear();
  });

  it('keeps the dialog and fields open and shows the error when the add fails', async () => {
    addUnwrap.mockRejectedValue({ message: 'GitHub repo not found' });
    await openDialog();
    await fill('owner/name');
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }));

    expect(await screen.findByText(/GitHub repo not found/)).toBeInTheDocument();
    expect(screen.getByLabelText('или GitHub репозиторий')).toHaveValue('owner/name');
    expect(screen.getByLabelText('Локальный путь')).toHaveValue('/tmp/repo');
  });

  it('closes the dialog and clears the form after a successful add', async () => {
    addUnwrap.mockResolvedValue({});
    await openDialog();
    await fill('owner/name');
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }));

    expect(addTrackedProject).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByLabelText('Локальный путь')).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /Добавить репозиторий/ }));
    expect(screen.getByLabelText('Локальный путь')).toHaveValue('');
  });

  it('rejects a GitHub repo without owner/name format', async () => {
    await openDialog();
    await fill('foo');

    expect(screen.getByText('Формат: owner/name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Добавить' })).toBeDisabled();

    await userEvent.clear(screen.getByLabelText('или GitHub репозиторий'));
    await userEvent.type(screen.getByLabelText('или GitHub репозиторий'), 'owner/name');

    expect(screen.getByRole('button', { name: 'Добавить' })).toBeEnabled();
  });
});
