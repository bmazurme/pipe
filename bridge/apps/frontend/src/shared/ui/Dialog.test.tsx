import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@gravity-ui/uikit';
import { describe, expect, it, vi } from 'vitest';

import { Dialog } from './Dialog';

function renderDialog(onClose: () => void) {
  render(
    <ThemeProvider theme="light">
      <p>за пределами окна</p>
      <Dialog open onClose={onClose} aria-labelledby="t">
        <Dialog.Header caption="Форма" id="t" />
        <Dialog.Body>
          <input aria-label="Поле" defaultValue="черновик" />
        </Dialog.Body>
        <Dialog.Footer textButtonCancel="Отмена" onClickButtonCancel={onClose} />
      </Dialog>
    </ThemeProvider>,
  );
}

describe('Dialog', () => {
  it('stays open when the click lands outside it, so typed text is not lost', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    renderDialog(onClose);
    await screen.findByRole('dialog');
    await user.click(document.body);
    await user.click(screen.getByText('за пределами окна'));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Поле')).toHaveValue('черновик');
  });

  it('still closes with the Cancel button and with Escape', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    renderDialog(onClose);
    await user.click(await screen.findByRole('button', { name: 'Отмена' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(await screen.findByLabelText('Поле'));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
