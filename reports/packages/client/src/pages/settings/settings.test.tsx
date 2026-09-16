import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider, Toaster, ToasterProvider } from '@gravity-ui/uikit';
import type { SettingsType } from '@reports/shared';

import { store } from '../../store';
import Settings from './index';

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

vi.mock('../../store/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSetSettingsMutation: () => [setSettingsRequest, { isLoading: false }],
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
