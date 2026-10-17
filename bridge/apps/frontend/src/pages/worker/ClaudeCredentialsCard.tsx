import { useState } from 'react';
import { TrashBin } from '@gravity-ui/icons';
import { Alert, Button, Card, Dialog, Icon, Label, Skeleton, Text, TextInput } from '@gravity-ui/uikit';

import {
  ClaudeCredential,
  useCreateClaudeCredentialMutation,
  useDeleteClaudeCredentialMutation,
  useListClaudeCredentialsQuery,
} from '../../store/api';
import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { ClaudeLimitsView } from './ClaudeLimitsView';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../WorkerPage.module.css';

export function ClaudeCredentialsCard() {
  const { data: credentials, isLoading, isError, refetch } = useListClaudeCredentialsQuery();
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [createClaudeCredential, { isLoading: isCreating }] = useCreateClaudeCredentialMutation();
  const [deleteClaudeCredential] = useDeleteClaudeCredentialMutation();
  const [createError, setCreateErrorState] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ClaudeCredential | null>(null);

  const handleCreate = async () => {
    if (!name.trim() || !token.trim()) return;
    setCreateErrorState(null);

    try {
      await createClaudeCredential({ name: name.trim(), token: token.trim() }).unwrap();
      setName('');
      setToken('');
    } catch (err) {
      setCreateErrorState(typeof err === 'string' ? err : 'Не удалось сохранить токен');
    }
  };

  const handleDelete = async (credential: ClaudeCredential) => {
    setDeleteError(null);
    setDeletingId(credential.id);
    try {
      await deleteClaudeCredential(credential.id).unwrap();
    } catch {
      setDeleteError(`Не удалось удалить токен «${credential.name}»`);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader title="Claude-токены" />
      <Text color="secondary" variant="caption-2">
        Несколько именованных Claude Code OAuth токенов — хранятся в базе bridge, без GitHub
        Secrets и передеплоя. Первый в списке используется по умолчанию при запуске задачи на
        Sonnet/Opus.
      </Text>

      {isLoading && <Skeleton height={40} />}

      {isError && (
        <Alert
          theme="danger"
          view="filled"
          message="Не удалось загрузить список токенов"
          actions={
            <Button view="outlined" size="s" onClick={() => void refetch()}>
              Повторить
            </Button>
          }
        />
      )}

      {!isLoading && !isError && credentials && credentials.length === 0 && (
        <Text color="secondary" variant="body-2">
          Токенов пока нет — добавьте первый ниже.
        </Text>
      )}

      {credentials && credentials.length > 0 && (
        <ul className={styles.jobList}>
          {credentials.map((credential: ClaudeCredential) => (
            <li key={credential.id} className={styles.credentialRow}>
              <div className={styles.credentialInfo}>
                <Text variant="body-2">{credential.name}</Text>
                {credential.authFailedAt && (
                  <>
                    <Label theme="danger">
                      Отклонён Anthropic · задача #{credential.authFailedJobId} ·{' '}
                      {formatRelativeTime(credential.authFailedAt)}
                    </Label>
                    <Text color="secondary" variant="caption-2">
                      Токен больше не принимается — замените его новым.
                    </Text>
                  </>
                )}
                <ClaudeLimitsView limits={credential.limits} emptyText="Лимиты появятся после первого запуска на этом токене" />
              </div>
              <Button
                view="flat-danger"
                size="s"
                aria-label={`Удалить токен: ${credential.name}`}
                loading={deletingId === credential.id}
                onClick={() => {
                  setDeleteError(null);
                  setPendingDelete(credential);
                }}
              >
                <Icon data={TrashBin} size={16} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.secretRow}>
        <TextInput value={name} onUpdate={setName} placeholder="Название (например, личный)" />
        <TextInput
          type="password"
          value={token}
          onUpdate={setToken}
          placeholder="claude token"
          hasClear
        />
        <Button
          view="normal"
          loading={isCreating}
          disabled={!name.trim() || !token.trim()}
          onClick={() => void handleCreate()}
        >
          Добавить
        </Button>
      </div>

      {createError && <Alert theme="danger" view="filled" message={createError} />}
      {deleteError && <Alert theme="danger" view="filled" message={deleteError} />}

      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        maxWidth="s"
        aria-labelledby="delete-claude-credential-title"
      >
        <Dialog.Header caption="Удалить токен?" id="delete-claude-credential-title" />
        <Dialog.Body>
          <Text color="secondary">
            Токен «{pendingDelete?.name}» будет удалён без возможности восстановления.
          </Text>
        </Dialog.Body>
        <Dialog.Footer
          preset="danger"
          textButtonCancel="Отмена"
          textButtonApply="Удалить"
          onClickButtonCancel={() => setPendingDelete(null)}
          onClickButtonApply={() => {
            const target = pendingDelete;
            setPendingDelete(null);
            if (target) void handleDelete(target);
          }}
        />
      </Dialog>
    </Card>
  );
}
