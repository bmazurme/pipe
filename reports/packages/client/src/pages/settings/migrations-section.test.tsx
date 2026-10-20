import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, Toaster, ToasterProvider } from '@gravity-ui/uikit';
import type { MigrationProjectType } from '@reports/shared';

const api = vi.hoisted(() => ({
  migrations: [] as unknown[],
  add: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('../../store/api', () => ({
  useGetSubscriptionConfigQuery: () => ({ data: { trackedProjects: [], migrations: api.migrations } }),
  useAddMigrationMutation: () => [api.add, { isLoading: false }],
  useRemoveMigrationMutation: () => [api.remove],
}));

import MigrationsSection from './migrations-section';

const existing: MigrationProjectType = { id: '4000000001', name: 'CRM → Nest', sourcePath: 'C:\\old', targetPath: 'C:\\new', targetBaseBranch: 'main' };

const renderSection = () =>
  render(
    <ThemeProvider theme="light">
      <ToasterProvider toaster={new Toaster()}>
        <MigrationsSection />
      </ToasterProvider>
    </ThemeProvider>,
  );

beforeEach(() => {
  api.migrations = [];
  api.add.mockReset();
  api.remove.mockReset();
});

async function fill(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, values: { name?: string; source?: string; target?: string }) {
  const paths = within(dialog).getAllByRole('textbox', { name: 'Путь' });

  if (values.name !== undefined) await user.type(within(dialog).getByRole('textbox', { name: 'Название' }), values.name);
  if (values.source !== undefined) await user.type(paths[0], values.source);
  if (values.target !== undefined) await user.type(paths[1], values.target);
}

describe('MigrationsSection', () => {
  it('lists the migrations with the two repositories each', () => {
    api.migrations = [existing];
    renderSection();

    expect(screen.getByText('CRM → Nest')).toBeInTheDocument();
    expect(screen.getByText('C:\\old → C:\\new · main')).toBeInTheDocument();
  });

  it('says there are none yet', () => {
    renderSection();

    expect(screen.getByText('Миграции ещё не добавлены')).toBeInTheDocument();
  });

  it('adds a migration with both paths, splitting the globs', async () => {
    api.add.mockReturnValue({ unwrap: () => Promise.resolve({}) });
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole('button', { name: /Добавить миграцию/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Добавить' })).toBeDisabled();

    await fill(user, dialog, { name: 'ERP', source: 'C:\\erp-old', target: 'C:\\erp-new' });
    await user.type(within(dialog).getAllByRole('textbox', { name: /Include/ })[0], '**/*.cs, **/*.csproj');
    await user.click(within(dialog).getByRole('button', { name: 'Добавить' }));

    await waitFor(() => expect(api.add).toHaveBeenCalledTimes(1));
    expect(api.add.mock.calls[0][0]).toMatchObject({
      name: 'ERP',
      sourcePath: 'C:\\erp-old',
      sourceInclude: ['**/*.cs', '**/*.csproj'],
      targetPath: 'C:\\erp-new',
    });
    expect(api.add.mock.calls[0][0].targetBaseBranch).toBeUndefined();
  });

  it('refuses the same folder twice and a name already taken, before asking the server', async () => {
    api.migrations = [existing];
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole('button', { name: /Добавить миграцию/ }));
    const dialog = await screen.findByRole('dialog');
    await fill(user, dialog, { name: 'CRM → Nest', source: 'C:\\same', target: 'C:\\same' });

    expect(within(dialog).getByText('Миграция с таким названием уже есть')).toBeInTheDocument();
    expect(within(dialog).getByText('Это та же папка, что и текущий репозиторий')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Добавить' })).toBeDisabled();
  });

  it('shows what the server found wrong with the folders', async () => {
    api.add.mockReturnValue({ unwrap: () => Promise.reject(new Error('Целевой репозиторий C:\\new — не git-репозиторий (нет .git)')) });
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole('button', { name: /Добавить миграцию/ }));
    const dialog = await screen.findByRole('dialog');
    await fill(user, dialog, { name: 'ERP', source: 'C:\\a', target: 'C:\\b' });
    await user.click(within(dialog).getByRole('button', { name: 'Добавить' }));

    expect(await screen.findByText(/не git-репозиторий/)).toBeInTheDocument();
  });

  it('removes a migration after a confirmation, and says repositories on disk are not touched', async () => {
    api.migrations = [existing];
    api.remove.mockReturnValue({ unwrap: () => Promise.resolve({}) });
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole('button', { name: 'Удалить миграцию CRM → Nest' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Репозитории на диске не изменятся/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(api.remove).toHaveBeenCalledWith({ id: '4000000001' }));
  });
});
