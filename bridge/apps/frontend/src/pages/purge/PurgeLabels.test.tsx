import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@gravity-ui/uikit';

import { AddEntryForm } from './AddEntryForm';
import { DictionaryEntryRow } from './DictionaryEntryRow';
import { EntryListCard } from './EntryListCard';
import { PurgeApplyTab } from './PurgeApplyTab';
import { store } from '../../store';

const ENTRIES = [{ id: 1, key: 'Иванов', value: 'Клиент А' }];

function wrap(node: React.ReactNode) {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">{node}</ThemeProvider>
    </Provider>,
  );
}

function renderRow(editError: string | null, showKeys = false) {
  return wrap(
    <ul>
      <DictionaryEntryRow
        entry={{ id: 1, key: 'Иванов', value: 'Клиент А', createdAt: '' }}
        isEditing
        editKey="Иванов"
        editValue="Клиент А"
        editError={editError}
        isEditSaving={false}
        isConfirmingDelete={false}
        showKeys={showKeys}
        onEditKeyChange={() => {}}
        onEditValueChange={() => {}}
        onEditKeyDown={() => {}}
        onSaveEdit={() => {}}
        onCancelEdit={() => {}}
        onStartEdit={() => {}}
        onDeleteClick={() => {}}
      />
    </ul>,
  );
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
});

describe('Purge accessible labels', () => {
  it('names the add-entry inputs', () => {
    wrap(<AddEntryForm showKeys={false} />);
    expect(screen.getByLabelText('Ключ')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Значение' })).toBeTruthy();
  });

  it('names the apply textarea', () => {
    wrap(<PurgeApplyTab onGoToDictionary={() => {}} />);
    expect(screen.getByRole('textbox', { name: 'Текст для очистки' })).toBeTruthy();
  });

  it('names the search box', async () => {
    wrap(<EntryListCard showKeys={false} onToggleShowKeys={() => {}} />);
    expect(await screen.findByRole('textbox', { name: 'Поиск по словарю' })).toBeTruthy();
  });

  it('names the edit inputs without leaking the key', () => {
    renderRow(null);
    expect(screen.getByLabelText('Новый ключ')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Новое значение' })).toBeTruthy();
    expect(document.body.innerHTML).not.toMatch(/aria-label="[^"]*Иванов/);
  });

  it('marks both edit inputs invalid and described by the error', () => {
    renderRow('Такой ключ уже есть');
    const key = screen.getByLabelText('Новый ключ');
    const value = screen.getByRole('textbox', { name: 'Новое значение' });
    for (const input of [key, value]) {
      expect(input.getAttribute('aria-invalid')).toBe('true');
      const id = input.getAttribute('aria-describedby');
      expect(document.getElementById(id as string)?.textContent).toBe('Такой ключ уже есть');
    }
  });
});
