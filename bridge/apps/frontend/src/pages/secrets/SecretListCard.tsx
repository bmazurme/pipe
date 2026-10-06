import { Key } from '@gravity-ui/icons';
import { Alert, Card, Loader } from '@gravity-ui/uikit';

import { useListSecretsQuery } from '../../store/api';
import { EmptyState } from '../../widgets/EmptyState';
import { SectionHeader } from '../../widgets/SectionHeader';
import { SecretRow } from './SecretRow';
import styles from '../SecretsPage.module.css';
import { useSecretsEditing } from './useSecretsEditing';

export function SecretListCard() {
  const { data: secrets, isLoading, isError } = useListSecretsQuery();
  const editing = useSecretsEditing();

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader title="Секреты" meta={secrets && secrets.length > 0 ? String(secrets.length) : undefined} />

      {editing.deleteError && <Alert theme="danger" view="filled" message={editing.deleteError} />}
      {editing.revealError && <Alert theme="danger" view="filled" message={editing.revealError} />}

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

      {!isLoading && secrets && secrets.length > 0 && (
        <ul className={styles.entryList}>
          {secrets.map((secret) => (
            <SecretRow
              key={secret.id}
              secret={secret}
              isEditing={editing.editingId === secret.id}
              editName={editing.editName}
              editDescription={editing.editDescription}
              editValue={editing.editValue}
              editError={editing.editError}
              isEditSaving={editing.isEditSaving}
              isConfirmingDelete={editing.confirmDeleteId === secret.id}
              revealedValue={editing.revealedValues[secret.id]}
              isRevealing={editing.revealingId === secret.id}
              onEditNameChange={editing.setEditName}
              onEditDescriptionChange={editing.setEditDescription}
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
