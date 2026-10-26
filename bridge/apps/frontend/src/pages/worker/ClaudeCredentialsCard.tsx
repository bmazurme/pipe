import { useState } from 'react';
import { TrashBin } from '@gravity-ui/icons';
import { Alert, Button, Card, Icon, Label, Skeleton, Text, TextInput } from '@gravity-ui/uikit';
import { Dialog } from '../../shared/ui/Dialog';

import {
  ClaudeCredential,
  useCreateClaudeCredentialMutation,
  useDeleteClaudeCredentialMutation,
  useListClaudeCredentialsQuery,
  useUpdateClaudeCredentialMutation,
} from '../../store/api';
import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { ClaudeLimitsView } from './ClaudeLimitsView';
import { describeRecentUsage } from './claudeLimits';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../WorkerPage.module.css';

export function ClaudeCredentialsCard() {
  const { data: credentials, isLoading, isError, refetch } = useListClaudeCredentialsQuery();
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [createClaudeCredential, { isLoading: isCreating }] = useCreateClaudeCredentialMutation();
  const [deleteClaudeCredential] = useDeleteClaudeCredentialMutation();
  const [createError, setCreateErrorState] = useState<string | null>(null);
  const [updateClaudeCredential, { isLoading: isReplacing }] = useUpdateClaudeCredentialMutation();
  const [pendingReplace, setPendingReplace] = useState<ClaudeCredential | null>(null);
  const [replaceToken, setReplaceToken] = useState('');
  const [replaceError, setReplaceError] = useState<string | null>(null);
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

  const closeReplace = () => {
    setPendingReplace(null);
    setReplaceToken('');
    setReplaceError(null);
  };

  const handleReplace = async () => {
    if (!pendingReplace || !replaceToken.trim()) return;
    setReplaceError(null);

    try {
      await updateClaudeCredential({ id: pendingReplace.id, token: replaceToken.trim() }).unwrap();
      closeReplace();
    } catch (err) {
      setReplaceError(typeof err === 'string' ? err : 'Не удалось заменить токен');
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
        Sonnet/Opus/Haiku.
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
                      Токен больше не принимается — нажмите «Заменить» и вставьте новый.
                    </Text>
                  </>
                )}
                <ClaudeLimitsView limits={credential.limits} emptyText="Лимиты появятся после первого запуска на этом токене" />
                <Text color="secondary" variant="caption-2">
                  {describeRecentUsage(credential.usage7d)}
                </Text>
              </div>
              <Button
                view="outlined"
                size="s"
                aria-label={`Заменить токен: ${credential.name}`}
                onClick={() => setPendingReplace(credential)}
              >
                Заменить
              </Button>
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
        <TextInput
          value={name}
          onUpdate={setName}
          placeholder="Название (например, личный)"
          controlProps={{ 'aria-label': 'Название токена' }}
        />
        <TextInput
          type="password"
          value={token}
          onUpdate={setToken}
          placeholder="claude token"
          controlProps={{ 'aria-label': 'Claude-токен' }}
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
        open={pendingReplace !== null}
        onClose={closeReplace}
        maxWidth="s"
        aria-labelledby="replace-claude-credential-title"
      >
        <Dialog.Header caption="Заменить токен" id="replace-claude-credential-title" />
        <Dialog.Body>
          <Text color="secondary">
            Новое значение для «{pendingReplace?.name}» — название и привязки к worker'ам и задачам
            сохранятся.
          </Text>
          <TextInput
            type="password"
            value={replaceToken}
            onUpdate={setReplaceToken}
            placeholder="claude setup-token"
            controlProps={{ 'aria-label': 'Новый Claude-токен' }}
          />
          {replaceError && <Alert theme="danger" view="filled" message={replaceError} />}
        </Dialog.Body>
        <Dialog.Footer
          loading={isReplacing}
          textButtonCancel="Отмена"
          textButtonApply="Сохранить"
          propsButtonApply={{ disabled: !replaceToken.trim() }}
          onClickButtonCancel={closeReplace}
          onClickButtonApply={() => void handleReplace()}
        />
      </Dialog>

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
