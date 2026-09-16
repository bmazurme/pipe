import { KeyboardEvent } from 'react';
import { Check, Pencil, TrashBin, Xmark } from '@gravity-ui/icons';
import { Button, Icon, Text, TextInput } from '@gravity-ui/uikit';

import { PurgeEntry } from '../../store/api';
import styles from '../PurgePage.module.css';
import { mask } from './purgeUtils';

interface DictionaryEntryRowProps {
  entry: PurgeEntry;
  isEditing: boolean;
  editKey: string;
  editValue: string;
  editError: string | null;
  isEditSaving: boolean;
  isConfirmingDelete: boolean;
  showKeys: boolean;
  onEditKeyChange: (value: string) => void;
  onEditValueChange: (value: string) => void;
  onEditKeyDown: (event: KeyboardEvent) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onStartEdit: () => void;
  onDeleteClick: () => void;
}

export function DictionaryEntryRow({
  entry,
  isEditing,
  editKey,
  editValue,
  editError,
  isEditSaving,
  isConfirmingDelete,
  showKeys,
  onEditKeyChange,
  onEditValueChange,
  onEditKeyDown,
  onSaveEdit,
  onCancelEdit,
  onStartEdit,
  onDeleteClick,
}: DictionaryEntryRowProps) {
  // Never embed the key in an aria-label/title when it's meant to be
  // hidden — those are readable in the DOM regardless of what's painted.
  const editLabel = showKeys ? `Изменить ${entry.key}` : 'Изменить запись';
  const deleteLabel = showKeys ? `Удалить ${entry.key}` : 'Удалить запись';
  const confirmDeleteLabel = showKeys
    ? `Подтвердить удаление ${entry.key}`
    : 'Подтвердить удаление записи';

  if (isEditing) {
    return (
      <li className={styles.entryRow}>
        <div className={styles.entryEditPair}>
          <TextInput
            value={editKey}
            onUpdate={onEditKeyChange}
            onKeyDown={onEditKeyDown}
            type={showKeys ? 'text' : 'password'}
            autoFocus
            size="s"
          />
          <Text color="secondary">→</Text>
          <TextInput
            value={editValue}
            onUpdate={onEditValueChange}
            onKeyDown={onEditKeyDown}
            size="s"
          />
        </div>
        <div className={styles.rowActions}>
          <Button
            view="flat"
            size="s"
            title="Сохранить"
            aria-label="Сохранить"
            loading={isEditSaving}
            disabled={!editKey.trim() || !editValue.trim()}
            onClick={onSaveEdit}
          >
            <Icon data={Check} size={16} />
          </Button>
          <Button
            view="flat"
            size="s"
            title="Отменить"
            aria-label="Отменить"
            onClick={onCancelEdit}
          >
            <Icon data={Xmark} size={16} />
          </Button>
        </div>
        {editError && (
          <Text color="danger" className={styles.editError}>
            {editError}
          </Text>
        )}
      </li>
    );
  }

  return (
    <li className={styles.entryRow}>
      <div className={styles.entryPair}>
        <Text ellipsis>{showKeys ? entry.key : mask(entry.key)}</Text>
        <Text color="secondary">→</Text>
        <Text ellipsis>{entry.value}</Text>
      </div>
      <div className={styles.rowActions}>
        <Button view="flat" size="s" title={editLabel} aria-label={editLabel} onClick={onStartEdit}>
          <Icon data={Pencil} size={16} />
        </Button>
        <Button
          view={isConfirmingDelete ? 'flat-danger' : 'flat'}
          size="s"
          title={isConfirmingDelete ? 'Нажмите ещё раз для подтверждения' : deleteLabel}
          aria-label={isConfirmingDelete ? confirmDeleteLabel : deleteLabel}
          onClick={onDeleteClick}
        >
          <Icon data={TrashBin} size={16} />
        </Button>
      </div>
    </li>
  );
}
