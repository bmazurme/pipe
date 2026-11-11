import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../../test/render';
import { QuickSwitch } from './QuickSwitch';

function setup(over: Partial<React.ComponentProps<typeof QuickSwitch>> = {}) {
  const props = { open: true, onClose: vi.fn(), isOwner: true, currentPath: '/', navigate: vi.fn(), ...over };

  renderWithTheme(<QuickSwitch {...props} />);

  return props;
}

describe('QuickSwitch', () => {
  it('lists the pages, marks the current one, and has the field focused', async () => {
    setup({ currentPath: '/dashboard' });

    // The modal's focus manager moves focus a moment after it opens.
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Куда перейти' })).toHaveFocus());
    expect(screen.getByRole('option', { name: /Дашборд/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('вы здесь')).toBeInTheDocument();
  });

  it('narrows the list as you type, and Enter goes to the first match', () => {
    const { navigate, onClose } = setup();
    const field = screen.getByRole('combobox', { name: 'Куда перейти' });

    fireEvent.change(field, { target: { value: 'дашб' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);

    fireEvent.keyDown(field, { key: 'Enter' });

    expect(navigate).toHaveBeenCalledWith('/dashboard');
    expect(onClose).toHaveBeenCalled();
  });

  it('walks the list with the arrows (and wraps) before Enter', () => {
    const { navigate } = setup();
    const field = screen.getByRole('combobox', { name: 'Куда перейти' });
    const options = screen.getAllByRole('option');

    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(field, { key: 'ArrowUp' });
    fireEvent.keyDown(field, { key: 'ArrowUp' });
    expect(screen.getAllByRole('option').at(-1)).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(field, { key: 'Enter' });
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('goes to a page that is clicked', () => {
    const { navigate } = setup();

    fireEvent.click(screen.getByRole('option', { name: /VPN/ }));

    expect(navigate).toHaveBeenCalledWith('/vpn');
  });

  it('says so when nothing matches, and Enter then does nothing', () => {
    const { navigate } = setup();
    const field = screen.getByRole('combobox', { name: 'Куда перейти' });

    fireEvent.change(field, { target: { value: 'нетутакого' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(screen.getByText('Нет такого раздела')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not list the owner-only pages for anyone else', () => {
    setup({ isOwner: false });

    expect(screen.queryByRole('option', { name: /Дашборд/ })).toBeNull();
    expect(screen.getByRole('option', { name: /Главная/ })).toBeInTheDocument();
  });

  it('draws nothing while closed', () => {
    setup({ open: false });

    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
