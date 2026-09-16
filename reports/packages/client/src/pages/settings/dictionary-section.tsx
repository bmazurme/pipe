import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Button, TextInput, Text, Icon, useToaster,
} from '@gravity-ui/uikit';
import {
  ArrowDownToLine, ArrowUpFromLine, Check, Eye, EyeSlash, Magnifier, Pencil, Plus, TrashBin, Xmark,
} from '@gravity-ui/icons';
import type { DictionaryEntryType } from '@reports/shared';

import {
  useGetSubscriptionConfigQuery,
  useAddDictionaryEntryMutation,
  useRemoveDictionaryEntryMutation,
  useUpdateDictionaryEntryMutation,
  useImportDictionaryEntriesMutation,
} from '../../store/api';
import { describeError } from '../../utils/describe-error';

import style from './settings.module.css';

/** Same-length dot mask as bridge's Purge page, so the real value never renders in the clear by default. */
function mask(value: string): string {
  return '•'.repeat(Math.min(value.length, 40)) || '—';
}

/**
 * Accepts the same plain `[{ key, value }]` array shape as bridge's Purge
 * export, so a dictionary exported from bridge (or ntlstl.sync) can be
 * imported here unchanged.
 */
function parseImportedEntries(raw: string): DictionaryEntryType[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Файл повреждён или не является корректным JSON');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Файл должен содержать массив пар { key, value }');
  }

  return parsed.map((item, index) => {
    const key = (item as { key?: unknown } | null)?.key;
    const value = (item as { value?: unknown } | null)?.value;

    if (typeof key !== 'string' || !key.trim()) {
      throw new Error(`Запись №${index + 1}: отсутствует или пустой "key"`);
    }

    return { key: key.trim(), value: typeof value === 'string' ? value.trim() : String(value ?? '') };
  });
}

function DictionarySection() {
  const toaster = useToaster();
  const { data: config } = useGetSubscriptionConfigQuery();
  const [addDictionaryEntry, { isLoading: isAdding }] = useAddDictionaryEntryMutation();
  const [removeDictionaryEntry] = useRemoveDictionaryEntryMutation();
  const [updateDictionaryEntry, { isLoading: isEditSaving }] = useUpdateDictionaryEntryMutation();
  const [importDictionaryEntries, { isLoading: isImporting }] = useImportDictionaryEntriesMutation();

  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [showKeys, setShowKeys] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editKey, setEditKey] = useState('');
  const [editValue, setEditValue] = useState('');

  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const confirmDeleteTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const dictionary = config?.dictionary ?? [];
  const isDuplicate = Boolean(newKey) && dictionary.some((entry) => entry.key === newKey);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return dictionary;
    }

    return dictionary.filter((entry) => entry.key.toLowerCase().includes(query) || entry.value.toLowerCase().includes(query));
  }, [dictionary, searchQuery]);

  const notifyError = (name: string, title: string, error: unknown) => {
    toaster.add({ name, theme: 'danger', title, content: describeError(error), isClosable: true });
  };

  const handleAdd = async () => {
    if (!newKey.trim() || !newValue.trim() || isDuplicate) {
      return;
    }

    const entry = { key: newKey.trim(), value: newValue.trim() };

    setNewKey('');
    setNewValue('');

    try {
      await addDictionaryEntry(entry).unwrap();
    } catch (error) {
      notifyError('dictionary-add-error', 'Не удалось добавить запись словаря', error);
    }
  };

  const handleAddKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && newKey.trim() && newValue.trim() && !isAdding) {
      event.preventDefault();
      void handleAdd();
    }
  };

  const handleStartEdit = (entry: DictionaryEntryType) => {
    setEditingKey(entry.key);
    setEditKey(entry.key);
    setEditValue(entry.value);
    setConfirmDeleteKey(null);
  };

  const handleCancelEdit = () => setEditingKey(null);

  const handleSaveEdit = async (originalKey: string) => {
    if (!editKey.trim() || !editValue.trim()) {
      return;
    }

    try {
      await updateDictionaryEntry({ oldKey: originalKey, entry: { key: editKey.trim(), value: editValue.trim() } }).unwrap();
      setEditingKey(null);
    } catch (error) {
      notifyError('dictionary-edit-error', 'Не удалось сохранить запись словаря', error);
    }
  };

  const handleEditKeyDown = (originalKey: string) => (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      handleCancelEdit();
    } else if (event.key === 'Enter' && editKey.trim() && editValue.trim() && !isEditSaving) {
      event.preventDefault();
      void handleSaveEdit(originalKey);
    }
  };

  const handleDeleteClick = (key: string) => {
    if (confirmDeleteTimeout.current) {
      clearTimeout(confirmDeleteTimeout.current);
    }

    if (confirmDeleteKey === key) {
      setConfirmDeleteKey(null);
      void removeDictionaryEntry({ key }).catch((error) => notifyError('dictionary-remove-error', 'Не удалось удалить запись словаря', error));
      return;
    }

    setConfirmDeleteKey(key);
    confirmDeleteTimeout.current = setTimeout(() => setConfirmDeleteKey(null), 3000);
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(dictionary, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = `subscription-dictionary-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file: File) => {
    try {
      const entries = parseImportedEntries(await file.text());

      await importDictionaryEntries({ entries }).unwrap();
      toaster.add({
        name: 'dictionary-import-success',
        theme: 'success',
        title: `Импортировано записей: ${entries.length}`,
        autoHiding: 3000,
      });
    } catch (error) {
      notifyError('dictionary-import-error', 'Не удалось импортировать словарь', error);
    }
  };

  return (
    <section className={style.codes}>
      <div className={style.sectionHead}>
        <Text variant="subheader-2">Словарь подстановки</Text>
        <Text variant="caption-2" color="secondary">
          Реальное значение → плейсхолдер при push, обратно при pull. Формат совпадает с экспортом Purge из bridge
        </Text>
      </div>

      <div className={style.codeForm}>
        <TextInput
          placeholder="Реальное значение"
          type={showKeys ? 'text' : 'password'}
          value={newKey}
          onUpdate={setNewKey}
          onKeyDown={handleAddKeyDown}
          validationState={isDuplicate ? 'invalid' : undefined}
          errorMessage={isDuplicate ? 'Такая запись уже есть' : undefined}
        />
        <TextInput
          placeholder="Плейсхолдер, например {{DB_HOST}}"
          value={newValue}
          onUpdate={setNewValue}
          onKeyDown={handleAddKeyDown}
        />
        <Button view="outlined" size="m" loading={isAdding} disabled={!newKey.trim() || !newValue.trim() || isDuplicate} onClick={handleAdd}>
          <Icon data={Plus} size={16} />
          Добавить
        </Button>
      </div>

      <div className={style.toolbar}>
        <Button view="flat" size="s" onClick={() => setShowKeys((prev) => !prev)} aria-label={showKeys ? 'Скрыть значения' : 'Показать значения'}>
          <Icon data={showKeys ? EyeSlash : Eye} size={16} />
          {showKeys ? 'Скрыть' : 'Показать'}
        </Button>
        <Button view="flat" size="s" disabled={dictionary.length === 0} onClick={handleExport}>
          <Icon data={ArrowDownToLine} size={16} />
          Экспорт
        </Button>
        <Button view="flat" size="s" loading={isImporting} onClick={() => fileInputRef.current?.click()}>
          <Icon data={ArrowUpFromLine} size={16} />
          Импорт
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];

            event.target.value = '';

            if (file) {
              void handleImportFile(file);
            }
          }}
        />
      </div>

      {dictionary.length > 0 && (
        <TextInput
          value={searchQuery}
          onUpdate={setSearchQuery}
          placeholder="Поиск по значению или плейсхолдеру"
          size="m"
          hasClear
          startContent={<Icon data={Magnifier} size={16} />}
        />
      )}

      {dictionary.length === 0 ? (
        <Text variant="body-2" color="secondary" className={style.codesEmpty}>
          Словарь пуст — код и текст задачи будут передаваться без подстановки
        </Text>
      ) : filtered.length === 0 ? (
        <Text variant="body-2" color="secondary" className={style.codesEmpty}>
          Ничего не найдено
        </Text>
      ) : (
        <ul className={style.codesList}>
          {filtered.map((entry) => (
            editingKey === entry.key ? (
              <li key={entry.key} className={style.codesItem}>
                <div className={style.entryEditRow}>
                  <TextInput
                    value={editKey}
                    onUpdate={setEditKey}
                    onKeyDown={handleEditKeyDown(entry.key)}
                    type={showKeys ? 'text' : 'password'}
                    size="s"
                    autoFocus
                  />
                  <Text color="secondary">→</Text>
                  <TextInput
                    value={editValue}
                    onUpdate={setEditValue}
                    onKeyDown={handleEditKeyDown(entry.key)}
                    size="s"
                  />
                </div>
                <Button view="flat" size="s" title="Сохранить" aria-label="Сохранить" loading={isEditSaving} onClick={() => handleSaveEdit(entry.key)}>
                  <Icon data={Check} size={16} />
                </Button>
                <Button view="flat" size="s" title="Отменить" aria-label="Отменить" onClick={handleCancelEdit}>
                  <Icon data={Xmark} size={16} />
                </Button>
              </li>
            ) : (
              <li key={entry.key} className={style.codesItem}>
                <span className={style.codesCode}>{entry.value}</span>
                <span className={style.codesLabel}>{showKeys ? entry.key : mask(entry.key)}</span>
                <Button view="flat" size="s" title="Изменить" aria-label={`Изменить ${entry.value}`} onClick={() => handleStartEdit(entry)}>
                  <Icon data={Pencil} size={16} />
                </Button>
                <Button
                  view={confirmDeleteKey === entry.key ? 'flat-danger' : 'flat'}
                  size="s"
                  title={confirmDeleteKey === entry.key ? 'Нажмите ещё раз для подтверждения' : 'Удалить'}
                  aria-label={`Удалить ${entry.value}`}
                  onClick={() => handleDeleteClick(entry.key)}
                  className={style.codesRemove}
                >
                  <Icon data={TrashBin} size={16} />
                </Button>
              </li>
            )
          ))}
        </ul>
      )}
    </section>
  )
}

export default DictionarySection;
