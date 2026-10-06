import { KeyboardEvent } from 'react';
import { Check, Eye, EyeSlash, Pencil, TrashBin, Xmark } from '@gravity-ui/icons';
import { Button, Icon, Text, TextInput } from '@gravity-ui/uikit';

import { Secret } from '../../store/api';
import styles from '../SecretsPage.module.css';

interface SecretRowProps {
  secret: Secret;
  isEditing: boolean;
  editName: string;
  editDescription: string;
  editValue: string;
  editError: string | null;
  isEditSaving: boolean;
  isConfirmingDelete: boolean;
  revealedValue: string | undefined;
  isRevealing: boolean;
  onEditNameChange: (value: string) => void;
  onEditDescriptionChange: (value: string) => void;
  onEditValueChange: (value: string) => void;
  onEditKeyDown: (event: KeyboardEvent) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onStartEdit: () => void;
  onDeleteClick: () => void;
  onToggleReveal: () => void;
}

export function SecretRow({
  secret,
  isEditing,
  editName,
  editDescription,
  editValue,
  editError,
  isEditSaving,
  isConfirmingDelete,
  revealedValue,
  isRevealing,
  onEditNameChange,
  onEditDescriptionChange,
  onEditValueChange,
  onEditKeyDown,
  onSaveEdit,
  onCancelEdit,
  onStartEdit,
  onDeleteClick,
  onToggleReveal,
}: SecretRowProps) {
  const isRevealed = revealedValue !== undefined;
  const editLabel = `Изменить ${secret.name}`;
  const deleteLabel = `Удалить ${secret.name}`;
  const confirmDeleteLabel = `Подтвердить удаление ${secret.name}`;
  const revealLabel = isRevealed ? `Скрыть значение ${secret.name}` : `Показать значение ${secret.name}`;

  if (isEditing) {
    return (
      <li className={styles.entryRow}>
        <div className={styles.entryEditFields}>
          <TextInput value={editName} onUpdate={onEditNameChange} onKeyDown={onEditKeyDown} placeholder="Имя" autoFocus size="s" />
          <TextInput
            value={editDescription}
            onUpdate={onEditDescriptionChange}
            onKeyDown={onEditKeyDown}
            placeholder="Описание (опционально)"
            size="s"
          />
          <TextInput
            value={editValue}
            onUpdate={onEditValueChange}
            onKeyDown={onEditKeyDown}
            placeholder="Новое значение — оставьте пустым, чтобы не менять"
            type="password"
            hasClear
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
            disabled={!editName.trim()}
            onClick={onSaveEdit}
          >
            <Icon data={Check} size={16} />
          </Button>
          <Button view="flat" size="s" title="Отменить" aria-label="Отменить" onClick={onCancelEdit}>
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
      <div className={styles.entryInfo}>
        <Text ellipsis>{secret.name}</Text>
        {secret.description && (
          <Text color="secondary" variant="caption-2" ellipsis>
            {secret.description}
          </Text>
        )}
        <Text color="secondary" variant="code-1" className={styles.valuePreview}>
          {isRevealed ? revealedValue : '••••••••'}
        </Text>
      </div>
      <div className={styles.rowActions}>
        <Button view="flat" size="s" title={revealLabel} aria-label={revealLabel} loading={isRevealing} onClick={onToggleReveal}>
          <Icon data={isRevealed ? EyeSlash : Eye} size={16} />
        </Button>
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
