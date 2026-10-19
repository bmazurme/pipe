import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider, Toaster, ToasterProvider } from '@gravity-ui/uikit';
import type { SettingsType } from '@reports/shared';

import { store } from '../../store';
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

vi.mock('../../store/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSetSettingsMutation: () => [setSettingsRequest, { isLoading: false }],
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
