import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { PurgeApplyTab } from './PurgeApplyTab';
import { store } from '../../store';
import { draftTextChanged } from '../../store/slices';

const ENTRIES = [
  { id: 1, key: 'Иванов', value: 'Клиент А' },
  { id: 2, key: 'Петров', value: 'Клиент Б' },
];

function renderTab() {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <PurgeApplyTab onGoToDictionary={() => {}} />
      </ThemeProvider>
    </Provider>,
  );
}

function textarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText('Вставьте текст');
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(ENTRIES), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  store.dispatch(draftTextChanged(''));
});

describe('PurgeApplyTab', () => {
  it('places both actions above the text field', async () => {
    renderTab();
    await screen.findByRole('button', { name: 'Сохранить' });

    const save = screen.getByRole('button', { name: 'Сохранить' });
    const copy = screen.getByRole('button', { name: /Копировать/ });

    // Node.compareDocumentPosition: FOLLOWING means the field comes after.
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(save.compareDocumentPosition(textarea()) & FOLLOWING).toBeTruthy();
    expect(copy.compareDocumentPosition(textarea()) & FOLLOWING).toBeTruthy();
  });

  it('replaces dictionary keys in the field and reports the count', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByRole('button', { name: 'Сохранить' });

    await user.type(textarea(), 'Иванов и Петров');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(textarea().value).toBe('Клиент А и Клиент Б');
    expect(screen.getByText('Заменено слов: 2')).toBeTruthy();
  });

  it('keeps the actions disabled, with a reason, until there is text', async () => {
    renderTab();
    await screen.findByRole('button', { name: 'Сохранить' });

    const save = screen.getByRole('button', { name: 'Сохранить' });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute('title', 'Вставьте текст в поле ниже');
  });

  it('clears the field only after the clipboard write succeeds', async () => {
    // userEvent.setup() installs its own navigator.clipboard stub, so ours
    // has to land after it or it gets overwritten.
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    renderTab();
    await screen.findByRole('button', { name: 'Сохранить' });

    await user.type(textarea(), 'Иванов');
    await user.click(screen.getByRole('button', { name: /Копировать/ }));

    await waitFor(() => expect(textarea().value).toBe(''));
    expect(writeText).toHaveBeenCalledWith('Иванов');
  });

  it('surfaces a failed copy as an error and keeps the text', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });

    renderTab();
    await screen.findByRole('button', { name: 'Сохранить' });

    await user.type(textarea(), 'Иванов');
    await user.click(screen.getByRole('button', { name: /Копировать/ }));

    // A silently-dropped copy that also wiped the field would lose the work.
    expect(await screen.findByText(/Не удалось скопировать/)).toBeTruthy();
    expect(textarea().value).toBe('Иванов');
  });
});
