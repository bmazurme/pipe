import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Check, Copy, Eye, EyeSlash, Pencil, TrashBin, Xmark } from '@gravity-ui/icons';
import { Button, Icon, Label, Text, TextInput } from '@gravity-ui/uikit';

import { Secret } from '../../store/api';
import { describeSecretExpiry } from './secretExpiry';
import styles from '../SecretsPage.module.css';

interface SecretRowProps {
  secret: Secret;
  isEditing: boolean;
  editName: string;
  editDescription: string;
  editExpiresOn: string;
  editValue: string;
  editError: string | null;
  isEditSaving: boolean;
  isConfirmingDelete: boolean;
  revealedValue: string | undefined;
  isRevealing: boolean;
  onEditNameChange: (value: string) => void;
  onEditDescriptionChange: (value: string) => void;
  onEditExpiresOnChange: (value: string) => void;
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
  editExpiresOn,
  editValue,
  editError,
  isEditSaving,
  isConfirmingDelete,
  revealedValue,
  isRevealing,
  onEditNameChange,
  onEditDescriptionChange,
  onEditExpiresOnChange,
  onEditValueChange,
  onEditKeyDown,
  onSaveEdit,
  onCancelEdit,
  onStartEdit,
  onDeleteClick,
  onToggleReveal,
}: SecretRowProps) {
  const isRevealed = revealedValue !== undefined;
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const copiedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimeout.current) clearTimeout(copiedTimeout.current);
    };
  }, []);

  const handleCopy = async () => {
    if (revealedValue === undefined) return;
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(revealedValue);
      setCopied(true);
      if (copiedTimeout.current) clearTimeout(copiedTimeout.current);
      copiedTimeout.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setCopyError('Не удалось скопировать');
    }
  };
  const expiryBadge = describeSecretExpiry(secret.expiresOn);
  const copyLabel = `Скопировать значение ${secret.name}`;
  const editLabel = `Изменить ${secret.name}`;
  const deleteLabel = `Удалить ${secret.name}`;
  const confirmDeleteLabel = `Подтвердить удаление ${secret.name}`;
  const revealLabel = isRevealed ? `Скрыть значение ${secret.name}` : `Показать значение ${secret.name}`;

  if (isEditing) {
    return (
      <li className={styles.entryRow}>
        <div className={styles.entryEditFields}>
          <TextInput
            value={editName}
            onUpdate={onEditNameChange}
            onKeyDown={onEditKeyDown}
            placeholder="Имя"
            controlProps={{ 'aria-label': `Имя секрета ${secret.name}` }}
            autoFocus
            size="s"
          />
          <TextInput
            value={editDescription}
            onUpdate={onEditDescriptionChange}
            onKeyDown={onEditKeyDown}
            placeholder="Описание (опционально)"
            controlProps={{ 'aria-label': `Описание секрета ${secret.name}` }}
            size="s"
          />
          <input
            type="date"
            className={styles.dateInput}
            value={editExpiresOn}
            onChange={(event) => onEditExpiresOnChange(event.target.value)}
            onKeyDown={onEditKeyDown}
            aria-label={`Действует до для ${secret.name}`}
            title="Действует до"
          />
          <TextInput
            value={editValue}
            onUpdate={onEditValueChange}
            onKeyDown={onEditKeyDown}
            placeholder="Новое значение"
            controlProps={{ 'aria-label': `Новое значение для ${secret.name}` }}
            note="Оставьте пустым, чтобы не менять"
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
        {expiryBadge && (
          <Label theme={expiryBadge.theme} size="xs">
            {expiryBadge.text}
          </Label>
        )}
        {secret.description && (
          <Text color="secondary" variant="caption-2" ellipsis>
            {secret.description}
          </Text>
        )}
        <Text color="secondary" variant="code-1" className={styles.valuePreview}>
          {isRevealed ? revealedValue : '••••••••'}
        </Text>
        {isRevealed && copyError && (
          <Text color="danger" variant="caption-2">
            {copyError}
          </Text>
        )}
      </div>
      <div className={styles.rowActions}>
        {isRevealed && (
          <Button view="flat" size="s" title={copyLabel} aria-label={copyLabel} onClick={() => void handleCopy()}>
            <Icon data={copied ? Check : Copy} size={16} />
          </Button>
        )}
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
