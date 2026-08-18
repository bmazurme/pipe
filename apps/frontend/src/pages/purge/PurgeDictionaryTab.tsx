import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Book,
  Eye,
  EyeSlash,
  Magnifier,
} from '@gravity-ui/icons';
import { Alert, Button, Card, Icon, Loader, Text, TextInput } from '@gravity-ui/uikit';

import {
  PurgeEntry,
  useCreateEntryMutation,
  useDeleteEntryMutation,
  useListEntriesQuery,
  useUpdateEntryMutation,
} from '../../store/api';
import { useAppSelector } from '../../store/hooks';
import { purgeEntriesSelector } from '../../store/slices';
import styles from '../PurgePage.module.css';
import { DictionaryEntryRow } from './DictionaryEntryRow';
import { parseImportedEntries, suggestUniqueValue } from './purgeUtils';

interface PurgeDictionaryTabProps {
  isActive: boolean;
}

export function PurgeDictionaryTab({ isActive }: PurgeDictionaryTabProps) {
  const { isLoading, isError: isEntriesError } = useListEntriesQuery();
  const entries = useAppSelector(purgeEntriesSelector);
  const [createEntryTrigger, { isLoading: isSaving }] = useCreateEntryMutation();
  const [updateEntryTrigger, { isLoading: isEditSaving }] = useUpdateEntryMutation();
  const [deleteEntryTrigger] = useDeleteEntryMutation();

  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [isValueTouched, setIsValueTouched] = useState(false);
  const [dictError, setDictError] = useState<string | null>(null);

  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [showKeys, setShowKeys] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editKey, setEditKey] = useState('');
  const [editValue, setEditValue] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  // Delete is two clicks: the first arms the row (and auto-disarms after a
  // few seconds), the second actually deletes. Cheap insurance against the
  // edit/delete icons sitting right next to each other.
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const confirmDeleteTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const newKeyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isActive) newKeyInputRef.current?.focus();
  }, [isActive]);

  useEffect(() => {
    return () => {
      if (confirmDeleteTimeout.current) clearTimeout(confirmDeleteTimeout.current);
    };
  }, []);

  const handleKeyChange = (value: string) => {
    setNewKey(value);

    // Keep proposing a fresh same-length value as the key changes, but only
    // until the user actually edits the value field themselves.
    if (!isValueTouched) {
      if (!value) {
        setNewValue('');
      } else {
        const takenValues = new Set(entries.map((entry) => entry.value));
        setNewValue(suggestUniqueValue(value.length, takenValues));
      }
    }
  };

  const handleAddEntry = async () => {
    const key = newKey.trim();
    const value = newValue.trim();
    if (!key || !value) return;

    setDictError(null);

    try {
      await createEntryTrigger({ key, value }).unwrap();
      setNewKey('');
      setNewValue('');
      setIsValueTouched(false);
    } catch (err) {
      setDictError(typeof err === 'string' ? err : 'Не удалось добавить запись');
    }
  };

  const handleDeleteEntry = async (id: number) => {
    setDictError(null);
    if (editingId === id) setEditingId(null);
    try {
      await deleteEntryTrigger(id).unwrap();
    } catch {
      setDictError('Не удалось удалить запись');
    }
  };

  const handleDeleteClick = (id: number) => {
    if (confirmDeleteTimeout.current) clearTimeout(confirmDeleteTimeout.current);

    if (confirmDeleteId === id) {
      setConfirmDeleteId(null);
      void handleDeleteEntry(id);
      return;
    }

    setConfirmDeleteId(id);
    confirmDeleteTimeout.current = setTimeout(() => setConfirmDeleteId(null), 3000);
  };

  const handleStartEdit = (entry: PurgeEntry) => {
    setEditingId(entry.id);
    setEditKey(entry.key);
    setEditValue(entry.value);
    setEditError(null);
    setConfirmDeleteId(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditError(null);
  };

  const handleAddFormKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && newKey.trim() && newValue.trim() && !isSaving) {
      event.preventDefault();
      void handleAddEntry();
    }
  };

  const handleSaveEdit = async (id: number) => {
    const key = editKey.trim();
    const value = editValue.trim();
    if (!key || !value) return;

    setEditError(null);

    try {
      await updateEntryTrigger({ id, key, value }).unwrap();
      setEditingId(null);
    } catch (err) {
      setEditError(typeof err === 'string' ? err : 'Не удалось сохранить изменения');
    }
  };

  const handleEditKeyDown = (id: number) => (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      handleCancelEdit();
    } else if (event.key === 'Enter' && editKey.trim() && editValue.trim() && !isEditSaving) {
      event.preventDefault();
      void handleSaveEdit(id);
    }
  };

  const filteredEntries = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return entries;

    return entries.filter(
      (entry) =>
        entry.key.toLowerCase().includes(query) ||
        entry.value.toLowerCase().includes(query),
    );
  }, [entries, searchQuery]);

  const handleExport = () => {
    const data = entries.map(({ key, value }) => ({ key, value }));
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `purge-dictionary-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file: File) => {
    setIsImporting(true);
    setDictError(null);
    setImportMessage(null);

    try {
      const items = parseImportedEntries(await file.text());

      let imported = 0;
      let skipped = 0;

      // Sequential on purpose: key/value uniqueness is enforced by the
      // backend per request, so concurrent inserts could race each other.
      for (const item of items) {
        try {
          await createEntryTrigger({ key: item.key, value: item.value }).unwrap();
          imported += 1;
        } catch {
          skipped += 1;
        }
      }

      // A skip can now mean a duplicate key/value (our own dictionary rule)
      // or an empty value (ntlstl/purge allows one, our backend doesn't) —
      // no longer just duplicates, so the message stays generic.
      setImportMessage(
        skipped > 0
          ? `Импортировано: ${imported}, пропущено: ${skipped}`
          : `Импортировано: ${imported}`,
      );
    } catch (err) {
      setDictError(err instanceof Error ? err.message : 'Не удалось прочитать файл');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className={styles.tabPanel}>
      <Card view="outlined" className={styles.card}>
        <div className={styles.addForm}>
          <TextInput
            controlRef={newKeyInputRef}
            value={newKey}
            onUpdate={handleKeyChange}
            onKeyDown={handleAddFormKeyDown}
            placeholder="Ключ"
            type={showKeys ? 'text' : 'password'}
            size="l"
          />
          <TextInput
            value={newValue}
            onUpdate={(value) => {
              setNewValue(value);
              setIsValueTouched(true);
            }}
            onKeyDown={handleAddFormKeyDown}
            placeholder="Значение"
            size="l"
          />
          <Button
            view="action"
            size="l"
            loading={isSaving}
            disabled={!newKey.trim() || !newValue.trim()}
            onClick={() => void handleAddEntry()}
          >
            Добавить
          </Button>
        </div>

        {dictError && (
          <Alert
            theme="danger"
            view="filled"
            message={dictError}
            onClose={() => setDictError(null)}
          />
        )}
      </Card>

      <Card view="outlined" className={styles.card}>
        <div className={styles.entriesHeader}>
          <Text variant="subheader-2">Записи</Text>
          <div className={styles.toolbar}>
            <Button
              view="flat"
              size="s"
              title={showKeys ? 'Скрыть ключи' : 'Показать ключи'}
              aria-label={showKeys ? 'Скрыть ключи' : 'Показать ключи'}
              onClick={() => setShowKeys((value) => !value)}
            >
              <Icon data={showKeys ? EyeSlash : Eye} size={16} />
            </Button>
            <Button
              view="flat"
              size="s"
              disabled={entries.length === 0}
              onClick={handleExport}
            >
              <Icon data={ArrowDownToLine} size={16} />
              Экспорт
            </Button>
            <Button
              view="flat"
              size="s"
              loading={isImporting}
              onClick={() => fileInputRef.current?.click()}
            >
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
                if (file) void handleImportFile(file);
              }}
            />
          </div>
        </div>

        {importMessage && <Text color="secondary">{importMessage}</Text>}

        {!isLoading && entries.length > 0 && (
          <TextInput
            value={searchQuery}
            onUpdate={setSearchQuery}
            placeholder="Поиск по ключу или значению"
            size="m"
            hasClear
            startContent={<Icon data={Magnifier} size={16} className={styles.searchIcon} />}
            className={styles.search}
          />
        )}

        {isLoading && (
          <div className={styles.centered}>
            <Loader size="m" />
          </div>
        )}

        {isEntriesError && !isLoading && (
          <Alert theme="danger" view="filled" message="Не удалось загрузить словарь" />
        )}

        {!isLoading && !isEntriesError && entries.length === 0 && (
          <div className={styles.centered}>
            <Icon data={Book} size={24} className={styles.emptyIcon} />
            <Text color="secondary">Словарь пуст</Text>
          </div>
        )}

        {!isLoading && entries.length > 0 && filteredEntries.length === 0 && (
          <div className={styles.centered}>
            <Icon data={Magnifier} size={24} className={styles.emptyIcon} />
            <Text color="secondary">Ничего не найдено</Text>
          </div>
        )}

        {!isLoading && filteredEntries.length > 0 && (
          <ul className={styles.entryList}>
            {filteredEntries.map((entry) => (
              <DictionaryEntryRow
                key={entry.id}
                entry={entry}
                isEditing={editingId === entry.id}
                editKey={editKey}
                editValue={editValue}
                editError={editError}
                isEditSaving={isEditSaving}
                isConfirmingDelete={confirmDeleteId === entry.id}
                showKeys={showKeys}
                onEditKeyChange={setEditKey}
                onEditValueChange={setEditValue}
                onEditKeyDown={handleEditKeyDown(entry.id)}
                onSaveEdit={() => void handleSaveEdit(entry.id)}
                onCancelEdit={handleCancelEdit}
                onStartEdit={() => handleStartEdit(entry)}
                onDeleteClick={() => handleDeleteClick(entry.id)}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
