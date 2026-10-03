import { useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Book, Eye, EyeSlash, Magnifier } from '@gravity-ui/icons';
import { Alert, Button, Card, Icon, Loader, Text, TextInput } from '@gravity-ui/uikit';

import { useListEntriesQuery } from '../../store/api';
import { useAppSelector } from '../../store/hooks';
import { purgeEntriesSelector } from '../../store/slices';
import { EmptyState } from '../../widgets/EmptyState';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../PurgePage.module.css';
import { DictionaryEntryRow } from './DictionaryEntryRow';
import { useDictionaryEditing } from './useDictionaryEditing';
import { useDictionaryImportExport } from './useDictionaryImportExport';

interface EntryListCardProps {
  showKeys: boolean;
  onToggleShowKeys: () => void;
}

export function EntryListCard({ showKeys, onToggleShowKeys }: EntryListCardProps) {
  const { isLoading, isError: isEntriesError } = useListEntriesQuery();
  const entries = useAppSelector(purgeEntriesSelector);
  const editing = useDictionaryEditing();
  const { isImporting, importMessage, importError, handleExport, handleImportFile } =
    useDictionaryImportExport(entries);

  const [searchQuery, setSearchQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredEntries = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return entries;

    return entries.filter(
      (entry) =>
        entry.key.toLowerCase().includes(query) ||
        entry.value.toLowerCase().includes(query),
    );
  }, [entries, searchQuery]);

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader
        title="Записи"
        meta={entries.length > 0 ? String(entries.length) : undefined}
        actions={
          <>
            <Button
              view="flat"
              size="s"
              title={showKeys ? 'Скрыть ключи' : 'Показать ключи'}
              aria-label={showKeys ? 'Скрыть ключи' : 'Показать ключи'}
              onClick={onToggleShowKeys}
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
          </>
        }
      />

      {importMessage && <Text color="secondary">{importMessage}</Text>}
      {importError && <Alert theme="danger" view="filled" message={importError} />}
      {editing.deleteError && <Alert theme="danger" view="filled" message={editing.deleteError} />}

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
        <EmptyState
          icon={Book}
          title="Словарь пуст"
          description="Добавьте пару «ключ — значение» выше, чтобы начать заменять слова."
        />
      )}

      {!isLoading && entries.length > 0 && filteredEntries.length === 0 && (
        <EmptyState
          icon={Magnifier}
          title="Ничего не найдено"
          description="Попробуйте другой запрос или очистите поиск."
        />
      )}

      {!isLoading && filteredEntries.length > 0 && (
        <ul className={styles.entryList}>
          {filteredEntries.map((entry) => (
            <DictionaryEntryRow
              key={entry.id}
              entry={entry}
              isEditing={editing.editingId === entry.id}
              editKey={editing.editKey}
              editValue={editing.editValue}
              editError={editing.editError}
              isEditSaving={editing.isEditSaving}
              isConfirmingDelete={editing.confirmDeleteId === entry.id}
              showKeys={showKeys}
              onEditKeyChange={editing.setEditKey}
              onEditValueChange={editing.setEditValue}
              onEditKeyDown={editing.handleEditKeyDown(entry.id)}
              onSaveEdit={() => void editing.handleSaveEdit(entry.id)}
              onCancelEdit={editing.handleCancelEdit}
              onStartEdit={() => editing.handleStartEdit(entry)}
              onDeleteClick={() => editing.handleDeleteClick(entry.id)}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}
