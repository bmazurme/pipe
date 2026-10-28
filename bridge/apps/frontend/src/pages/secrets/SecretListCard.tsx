import { useMemo, useState } from 'react';
import { Key, Magnifier } from '@gravity-ui/icons';
import { Alert, Card, Icon, Loader, TextInput } from '@gravity-ui/uikit';

import { useListSecretsQuery } from '../../store/api';
import { EmptyState } from '../../widgets/EmptyState';
import { SectionHeader } from '../../widgets/SectionHeader';
import { SecretRow } from './SecretRow';
import styles from '../SecretsPage.module.css';
import { useSecretsEditing } from './useSecretsEditing';

export function SecretListCard() {
  const { data: secrets, isLoading, isError } = useListSecretsQuery();
  const editing = useSecretsEditing();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredSecrets = useMemo(() => {
    if (!secrets) return [];
    const query = searchQuery.trim().toLowerCase();
    if (!query) return secrets;

    return secrets.filter(
      (secret) =>
        secret.name.toLowerCase().includes(query) ||
        (secret.description ?? '').toLowerCase().includes(query),
    );
  }, [secrets, searchQuery]);

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader title="Секреты" meta={secrets && secrets.length > 0 ? String(secrets.length) : undefined} />

      {editing.deleteError && <Alert theme="danger" view="filled" message={editing.deleteError} />}
      {editing.revealError && <Alert theme="danger" view="filled" message={editing.revealError} />}

      {!isLoading && !isError && secrets && secrets.length > 0 && (
        <TextInput
          value={searchQuery}
          onUpdate={setSearchQuery}
          placeholder="Поиск по имени или описанию"
          controlProps={{ 'aria-label': 'Поиск по секретам' }}
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

      {isError && !isLoading && <Alert theme="danger" view="filled" message="Не удалось загрузить список секретов" />}

      {!isLoading && !isError && secrets && secrets.length === 0 && (
        <EmptyState
          icon={Key}
          title="Секретов пока нет"
          description="Добавьте имя и значение выше, чтобы начать хранить секреты."
        />
      )}

      {!isLoading && secrets && secrets.length > 0 && filteredSecrets.length === 0 && (
        <EmptyState
          icon={Magnifier}
          title="Ничего не найдено"
          description="Попробуйте другой запрос или очистите поиск."
        />
      )}

      {!isLoading && filteredSecrets.length > 0 && (
        <ul className={styles.entryList}>
          {filteredSecrets.map((secret) => (
            <SecretRow
              key={secret.id}
              secret={secret}
              isEditing={editing.editingId === secret.id}
              editName={editing.editName}
              editDescription={editing.editDescription}
              editExpiresOn={editing.editExpiresOn}
              editValue={editing.editValue}
              editError={editing.editError}
              isEditSaving={editing.isEditSaving}
              isConfirmingDelete={editing.confirmDeleteId === secret.id}
              revealedValue={editing.revealedValues[secret.id]}
              isRevealing={editing.revealingId === secret.id}
              onEditNameChange={editing.setEditName}
              onEditDescriptionChange={editing.setEditDescription}
              onEditExpiresOnChange={editing.setEditExpiresOn}
              onEditValueChange={editing.setEditValue}
              onEditKeyDown={editing.handleEditKeyDown(secret.id)}
              onSaveEdit={() => void editing.handleSaveEdit(secret.id)}
              onCancelEdit={editing.handleCancelEdit}
              onStartEdit={() => editing.handleStartEdit(secret)}
              onDeleteClick={() => editing.handleDeleteClick(secret.id)}
              onToggleReveal={() => void editing.handleToggleReveal(secret.id)}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}
