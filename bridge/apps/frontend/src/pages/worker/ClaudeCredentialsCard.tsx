import { useState } from 'react';
import { TrashBin } from '@gravity-ui/icons';
import { Alert, Button, Card, Icon, Skeleton, Text, TextInput } from '@gravity-ui/uikit';

import {
  ClaudeCredential,
  useCreateClaudeCredentialMutation,
  useDeleteClaudeCredentialMutation,
  useListClaudeCredentialsQuery,
} from '../../store/api';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../WorkerPage.module.css';

export function ClaudeCredentialsCard() {
  const { data: credentials, isLoading } = useListClaudeCredentialsQuery();
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [createClaudeCredential, { isLoading: isCreating }] = useCreateClaudeCredentialMutation();
  const [deleteClaudeCredential] = useDeleteClaudeCredentialMutation();
  const [createError, setCreateErrorState] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

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

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      await deleteClaudeCredential(id).unwrap();
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

      {credentials && credentials.length > 0 && (
        <ul className={styles.jobList}>
          {credentials.map((credential: ClaudeCredential) => (
            <li key={credential.id} className={styles.credentialRow}>
              <Text variant="body-2">{credential.name}</Text>
              <Button
                view="flat-danger"
                size="s"
                aria-label={`Удалить токен: ${credential.name}`}
                loading={deletingId === credential.id}
                onClick={() => void handleDelete(credential.id)}
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
    </Card>
  );
}
