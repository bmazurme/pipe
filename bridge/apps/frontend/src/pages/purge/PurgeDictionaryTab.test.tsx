import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { PurgeDictionaryTab } from './PurgeDictionaryTab';
import { store } from '../../store';

const mocks = vi.hoisted(() => ({
  deleteEntry: vi.fn(),
  updateEntry: vi.fn(),
  createEntry: vi.fn(),
  entries: [
    { id: 1, key: 'Иванов', value: 'Клиент А', createdAt: '' },
    { id: 2, key: 'Петров', value: 'Клиент Б', createdAt: '' },
  ],
}));

// Each mutation hook returns [trigger, state]; the trigger's result has an
// `.unwrap()` like RTK Query's, so a rejected mock behaves like a failed request.
function mutation(fn: (arg: never) => Promise<unknown>) {
  return () => [(arg: never) => ({ unwrap: () => fn(arg) }), { isLoading: false }];
}

vi.mock('../../store/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/api')>()),
  useListEntriesQuery: () => ({ isLoading: false, isError: false }),
  useDeleteEntryMutation: mutation((arg) => mocks.deleteEntry(arg)),
  useUpdateEntryMutation: mutation((arg) => mocks.updateEntry(arg)),
  useCreateEntryMutation: mutation((arg) => mocks.createEntry(arg)),
}));

vi.mock('../../store/slices', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/slices')>()),
  purgeEntriesSelector: () => mocks.entries,
}));

function renderTab() {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <PurgeDictionaryTab />
      </ThemeProvider>
    </Provider>,
  );
}

const deleteButtons = () => screen.getAllByRole('button', { name: 'Удалить запись' });

beforeEach(() => {
  mocks.deleteEntry.mockReset().mockResolvedValue(undefined);
  mocks.updateEntry.mockReset().mockResolvedValue(undefined);
  mocks.createEntry.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Purge dictionary: two-click delete', () => {
  it('does not delete on the first click, deletes on the second', async () => {
    renderTab();
    fireEvent.click(deleteButtons()[0]);
    expect(mocks.deleteEntry).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить удаление записи' }));
    await waitFor(() => expect(mocks.deleteEntry).toHaveBeenCalledWith(1));
    expect(mocks.deleteEntry).toHaveBeenCalledTimes(1);
  });

  it('disarms after 3 s so a single click does not delete', () => {
    vi.useFakeTimers();
    renderTab();
    fireEvent.click(deleteButtons()[0]);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByRole('button', { name: 'Подтвердить удаление записи' })).toBeNull();

    fireEvent.click(deleteButtons()[0]);
    expect(mocks.deleteEntry).not.toHaveBeenCalled();
  });

  it('shows an error when the delete is rejected', async () => {
    mocks.deleteEntry.mockRejectedValue(new Error('boom'));
    renderTab();
    fireEvent.click(deleteButtons()[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить удаление записи' }));
    expect(await screen.findByText('Не удалось удалить запись')).toBeTruthy();
  });
});

describe('Purge dictionary: keyboard editing', () => {
  function startEdit() {
    renderTab();
    fireEvent.click(screen.getAllByRole('button', { name: 'Изменить запись' })[0]);
    return {
      key: screen.getByLabelText('Новый ключ'),
      value: screen.getByRole('textbox', { name: 'Новое значение' }),
    };
  }

  it('Enter saves trimmed values and closes the editor', async () => {
    const { key, value } = startEdit();
    fireEvent.change(key, { target: { value: '  Сидоров ' } });
    fireEvent.change(value, { target: { value: ' Клиент В  ' } });
    fireEvent.keyDown(value, { key: 'Enter' });

    await waitFor(() =>
      expect(mocks.updateEntry).toHaveBeenCalledWith({ id: 1, key: 'Сидоров', value: 'Клиент В' }),
    );
    await waitFor(() => expect(screen.queryByLabelText('Новый ключ')).toBeNull());
  });

  it('Enter with an empty value does nothing', () => {
    const { value } = startEdit();
    fireEvent.change(value, { target: { value: '   ' } });
    fireEvent.keyDown(value, { key: 'Enter' });
    expect(mocks.updateEntry).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Новый ключ')).toBeTruthy();
  });

  it('Escape closes the editor without saving', () => {
    const { value } = startEdit();
    fireEvent.keyDown(value, { key: 'Escape' });
    expect(mocks.updateEntry).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Новый ключ')).toBeNull();
  });

  it('keeps the editor open and shows the error when the update is rejected', async () => {
    mocks.updateEntry.mockRejectedValue('Такой ключ уже есть');
    const { value } = startEdit();
    fireEvent.keyDown(value, { key: 'Enter' });

    expect(await screen.findByText('Такой ключ уже есть')).toBeTruthy();
    expect(screen.getByLabelText('Новый ключ')).toBeTruthy();
  });
});

describe('Purge dictionary: import', () => {
  function importFile(content: string) {
    const { container } = renderTab();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([content], 'dict.json', { type: 'application/json' });
    // jsdom's File lacks text() in some versions
    if (typeof file.text !== 'function') Object.defineProperty(file, 'text', { value: async () => content });
    fireEvent.change(input, { target: { files: [file] } });
  }

  it('counts imported and skipped entries and creates them one at a time', async () => {
    const resolvers: Array<() => void> = [];
    mocks.createEntry.mockImplementation(
      (arg: { key: string }) =>
        new Promise<void>((resolve, reject) => {
          resolvers.push(arg.key === 'b' ? () => reject(new Error('dup')) : resolve);
        }),
    );
    importFile(
      JSON.stringify([
        { key: 'a', value: '1' },
        { key: 'b', value: '2' },
        { key: 'c', value: '3' },
      ]),
    );

    await waitFor(() => expect(mocks.createEntry).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.createEntry).toHaveBeenCalledTimes(1);

    await act(async () => resolvers[0]());
    await waitFor(() => expect(mocks.createEntry).toHaveBeenCalledTimes(2));
    expect(mocks.createEntry).toHaveBeenCalledTimes(2);

    await act(async () => resolvers[1]());
    await waitFor(() => expect(mocks.createEntry).toHaveBeenCalledTimes(3));
    await act(async () => resolvers[2]());

    expect(await screen.findByText('Импортировано: 2, пропущено: 1')).toBeTruthy();
  });

  it('shows the parser error for an unparseable file', async () => {
    importFile('not json');
    expect(await screen.findByText('Файл повреждён или не является корректным JSON')).toBeTruthy();
    expect(mocks.createEntry).not.toHaveBeenCalled();
  });
});
