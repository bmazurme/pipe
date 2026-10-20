import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';
import type { MigrationProjectType } from '@reports/shared';

import MigrationDialog from './migration-dialog';

const migration = (id: string, name: string): MigrationProjectType => ({
  id,
  name,
  sourcePath: `C:\\projects\\${name}-old`,
  targetPath: `C:\\projects\\${name}-new`,
  targetBaseBranch: 'develop',
});

// The dialog moves focus into itself as it opens: typing before that would lose characters, so wait for it.
const renderDialog = async (migrations: MigrationProjectType[], onStart = vi.fn(), loading = false) => {
  render(
    <MemoryRouter>
      <ThemeProvider theme="light">
        <MigrationDialog open migrations={migrations} loading={loading} onClose={vi.fn()} onStart={onStart} />
      </ThemeProvider>
    </MemoryRouter>,
  );
  await screen.findByRole('dialog');
  await new Promise((resolve) => setTimeout(resolve, 50));

  return onStart;
};

describe('MigrationDialog', () => {
  it('sends the person\'s text with the only migration there is, the title left out when empty', async () => {
    const user = userEvent.setup();
    const onStart = await renderDialog([migration('4000000001', 'crm')]);

    // the two repositories it works with are named before anything is sent
    expect(screen.getByText(/Читается: C:\\projects\\crm-old\. Результат распакуется в: C:\\projects\\crm-new \(ветка задачи — от develop\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Создать задачу' })).toBeDisabled();

    await user.type(screen.getByLabelText('Задача'), '  Перенести модуль Orders  ');
    await user.click(screen.getByRole('button', { name: 'Создать задачу' }));

    expect(onStart).toHaveBeenCalledWith({ migrationId: '4000000001', description: 'Перенести модуль Orders', title: undefined });
  });

  it('sends the title when one was given', async () => {
    const user = userEvent.setup();
    const onStart = await renderDialog([migration('4000000001', 'crm')]);

    await user.type(screen.getAllByRole('textbox')[0], 'Orders');
    await user.type(screen.getByLabelText('Задача'), 'Модуль Orders');
    await user.click(screen.getByRole('button', { name: 'Создать задачу' }));

    expect(onStart).toHaveBeenCalledWith({ migrationId: '4000000001', description: 'Модуль Orders', title: 'Orders' });
  });

  it('offers a choice when there are several migrations', async () => {
    const user = userEvent.setup();
    await renderDialog([migration('4000000001', 'crm'), migration('4000000002', 'erp')]);

    // the first one is chosen by default; opening the list shows the other as well
    await user.click(screen.getByText('crm'));

    expect(await screen.findByText('erp')).toBeInTheDocument();
  });

  it('says to add a migration first, with a link to where, and has nothing to send', async () => {
    await renderDialog([]);

    expect(screen.getByText('Сначала добавьте миграцию')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Settings → Подписка → Миграции/ })).toHaveAttribute('href', '/settings');
    expect(screen.getByRole('button', { name: 'Создать задачу' })).toBeDisabled();
    expect(screen.queryByLabelText('Задача')).not.toBeInTheDocument();
  });
});
