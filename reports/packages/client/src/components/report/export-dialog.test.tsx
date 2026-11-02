import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@gravity-ui/uikit';

import ExportDialog from './export-dialog';

// The dialog moves focus into itself as it opens: clicking before that would be lost, so wait for it.
const renderDialog = async (onExport = vi.fn(), onClose = vi.fn()) => {
  render(
    <ThemeProvider theme="light">
      <ExportDialog open onClose={onClose} onExport={onExport} />
    </ThemeProvider>,
  );
  await screen.findByRole('dialog');
  await new Promise((resolve) => setTimeout(resolve, 50));
};

describe('ExportDialog', () => {
  it('exports sorted by hours, longest first, when nothing is changed', async () => {
    const onExport = vi.fn();

    await renderDialog(onExport);
    await userEvent.click(screen.getByRole('button', { name: 'Выгрузить' }));

    expect(onExport).toHaveBeenCalledWith({ field: 'time', direction: 'desc' });
  });

  it('passes the chosen field and order on export', async () => {
    const onExport = vi.fn();

    await renderDialog(onExport);
    await userEvent.click(screen.getAllByRole('combobox')[0]);
    await userEvent.click(await screen.findByRole('option', { name: 'Наименование задачи' }));
    await userEvent.click(screen.getAllByRole('combobox')[1]);
    await userEvent.click(await screen.findByRole('option', { name: 'По возрастанию' }));
    await userEvent.click(screen.getByRole('button', { name: 'Выгрузить' }));

    expect(onExport).toHaveBeenCalledWith({ field: 'name', direction: 'asc' });
  });

  it('does not export on cancel', async () => {
    const onExport = vi.fn();
    const onClose = vi.fn();

    await renderDialog(onExport, onClose);
    await userEvent.click(screen.getByRole('button', { name: 'Отмена' }));

    expect(onClose).toHaveBeenCalled();
    expect(onExport).not.toHaveBeenCalled();
  });
});
