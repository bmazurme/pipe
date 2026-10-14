import { useState } from 'react';
import { TrashBin } from '@gravity-ui/icons';
import { Alert, Button, Card, Disclosure, Icon, Select, Skeleton, Text, TextInput } from '@gravity-ui/uikit';

import {
  type ProviderCredential,
  type ProviderModel,
  useCreateProviderCredentialMutation,
  useDeleteProviderCredentialMutation,
  useListProviderCredentialsQuery,
} from '../../store/api';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../WorkerPage.module.css';
import { modelName } from './fleet';

const PROVIDERS: ProviderModel[] = ['gpt', 'deepseek', 'qwen'];

export function ProviderCredentialsCard() {
  const { data: credentials, isLoading } = useListProviderCredentialsQuery();
  const [createCredential, { isLoading: isCreating }] = useCreateProviderCredentialMutation();
  const [deleteCredential] = useDeleteProviderCredentialMutation();

  const [provider, setProvider] = useState<ProviderModel>('gpt');
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const canSave = name.trim() !== '' && apiKey.trim() !== '';

  const handleCreate = async () => {
    if (!canSave) return;
    setError(null);

    try {
      await createCredential({
        provider,
        name: name.trim(),
        apiKey: apiKey.trim(),
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        ...(model.trim() ? { model: model.trim() } : {}),
      }).unwrap();
      setName('');
      setApiKey('');
      setBaseUrl('');
      setModel('');
    } catch (err) {
      setError(typeof err === 'string' ? err : 'Не удалось сохранить ключ');
    }
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);

    try {
      await deleteCredential(id).unwrap();
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader
        title="API-ключи моделей"
        meta={credentials && credentials.length > 0 ? String(credentials.length) : undefined}
      />
      <Text color="secondary" variant="caption-2">
        Ключи GPT, DeepSeek и Qwen хранятся в bridge в зашифрованном виде и выдаются worker&apos;у вместе с задачей — в
        его переменных среды ничего не нужно, передеплой не требуется. По умолчанию берётся первый добавленный ключ
        провайдера; в форме задачи можно выбрать другой.
      </Text>

      {isLoading && <Skeleton height={40} />}

      {credentials && credentials.length > 0 && (
        <ul className={styles.jobList}>
          {credentials.map((credential: ProviderCredential) => (
            <li key={credential.id} className={styles.credentialRow}>
              <div className={styles.jobRowMain}>
                <Text variant="body-2">
                  {modelName(credential.provider)} · {credential.name}
                </Text>
                <Text color="secondary" variant="caption-2">
                  {credential.keyHint}
                  {credential.baseUrl && ` · ${credential.baseUrl}`}
                  {credential.model && ` · ${credential.model}`}
                </Text>
              </div>
              <Button
                view="flat-danger"
                size="s"
                aria-label={`Удалить ключ: ${credential.name}`}
                loading={deletingId === credential.id}
                onClick={() => void handleDelete(credential.id)}
              >
                <Icon data={TrashBin} size={16} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.dialogForm}>
        <div className={styles.fieldRow}>
          <Select
            value={[provider]}
            onUpdate={([value]) => setProvider((value as ProviderModel) ?? 'gpt')}
            options={PROVIDERS.map((value) => ({
              value,
              content: modelName(value),
            }))}
            aria-label="Провайдер"
            width="max"
          />
          <TextInput value={name} onUpdate={setName} placeholder="Название ключа (например, рабочий)" />
        </div>
        <TextInput
          type="password"
          value={apiKey}
          onUpdate={setApiKey}
          placeholder="API-ключ"
          hasClear
          autoComplete="off"
        />

        <Disclosure summary="Свой адрес или модель (необязательно)">
          <div className={styles.fieldRow}>
            <TextInput
              value={baseUrl}
              onUpdate={setBaseUrl}
              placeholder="https://api.example.com/v1"
              aria-label="Адрес API"
            />
            <TextInput value={model} onUpdate={setModel} placeholder="Модель, например gpt-4o" aria-label="Модель" />
          </div>
        </Disclosure>

        <div>
          <Button view="normal" loading={isCreating} disabled={!canSave} onClick={() => void handleCreate()}>
            Добавить ключ
          </Button>
        </div>
      </div>

      {error && <Alert theme="danger" view="filled" message={error} />}
    </Card>
  );
}
