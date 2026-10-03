import { useState } from 'react';
import { Button, Card, Text, TextInput } from '@gravity-ui/uikit';

import { useSetWorkerSecretMutation, WorkerSecretName } from '../../store/api';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../WorkerPage.module.css';

const WORKER_SECRET_FIELDS: { name: WorkerSecretName; label: string; placeholder: string }[] = [
  { name: 'WORKER_CLAUDE_CODE_OAUTH_TOKEN', label: 'Claude Code OAuth Token', placeholder: 'sk-ant-oat...' },
  { name: 'WORKER_OPENAI_API_KEY', label: 'OpenAI API Key', placeholder: 'sk-proj-...' },
  { name: 'WORKER_DEEPSEEK_API_KEY', label: 'DeepSeek API Key', placeholder: 'sk-...' },
  { name: 'WORKER_QWEN_API_KEY', label: 'Qwen API Key', placeholder: 'sk-...' },
];

function WorkerSecretField({ name, label, placeholder }: { name: WorkerSecretName; label: string; placeholder: string }) {
  const [value, setValue] = useState('');
  const [setWorkerSecret, { isLoading }] = useSetWorkerSecretMutation();
  const [result, setResult] = useState<'success' | 'error' | null>(null);

  const handleSave = async () => {
    if (!value.trim()) return;
    setResult(null);

    try {
      await setWorkerSecret({ name, value: value.trim() }).unwrap();
      setValue('');
      setResult('success');
    } catch {
      setResult('error');
    }
  };

  return (
    <label className={styles.secretField}>
      <Text variant="body-2" color="secondary">
        {label}
      </Text>
      <div className={styles.secretRow}>
        <TextInput
          type="password"
          value={value}
          onUpdate={(next) => {
            setValue(next);
            setResult(null);
          }}
          placeholder={placeholder}
          hasClear
        />
        <Button view="normal" loading={isLoading} disabled={!value.trim()} onClick={() => void handleSave()}>
          Сохранить
        </Button>
      </div>
      {result === 'success' && (
        <Text color="positive" variant="caption-2">
          Сохранено — запущен передеплой worker (~15 минут).
        </Text>
      )}
      {result === 'error' && (
        <Text color="danger" variant="caption-2">
          Не удалось сохранить
        </Text>
      )}
    </label>
  );
}

// Collapsed by default: a write-blind, set-once-and-forget action (the
// comment below explains why) that would otherwise push the actually
// recurring task — "Новая задача" — further down the page every time it's
// opened. Same collapse-behind-a-toggle pattern as VpnPage's add-connection
// form.
export function WorkerSecretsCard() {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader
        title="Ключи worker"
        actions={
          <Button view="flat" size="s" onClick={() => setIsExpanded((value) => !value)}>
            {isExpanded ? 'Скрыть' : 'Настроить'}
          </Button>
        }
      />

      {isExpanded && (
        <>
          <Text color="secondary" variant="caption-2">
            Ключи передаются один раз и не хранятся здесь для отображения — как и в GitHub
            Secrets, это запись «вслепую». Сохранение запускает передеплой worker (~15 минут).
          </Text>

          {WORKER_SECRET_FIELDS.map((field) => (
            <WorkerSecretField key={field.name} {...field} />
          ))}
        </>
      )}
    </Card>
  );
}
