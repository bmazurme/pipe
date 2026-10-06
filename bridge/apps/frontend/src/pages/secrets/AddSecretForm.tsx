import { KeyboardEvent, useRef, useState } from 'react';
import { Alert, Button, Card, TextInput } from '@gravity-ui/uikit';

import { useCreateSecretMutation } from '../../store/api';
import styles from '../SecretsPage.module.css';

export function AddSecretForm() {
  const [createSecretTrigger, { isLoading: isSaving }] = useCreateSecretMutation();

  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [description, setDescription] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement>(null);

  const canSubmit = name.trim() && value.trim();

  const handleCreate = async () => {
    if (!canSubmit) return;

    setCreateError(null);

    try {
      await createSecretTrigger({
        name: name.trim(),
        value: value.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
      }).unwrap();
      setName('');
      setValue('');
      setDescription('');
      nameInputRef.current?.focus();
    } catch (err) {
      setCreateError(typeof err === 'string' ? err : 'Не удалось сохранить секрет');
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && canSubmit && !isSaving) {
      event.preventDefault();
      void handleCreate();
    }
  };

  return (
    <Card view="outlined" className={styles.card}>
      <div className={styles.addForm}>
        <TextInput
          controlRef={nameInputRef}
          value={name}
          onUpdate={setName}
          onKeyDown={handleKeyDown}
          placeholder="Имя"
          size="l"
        />
        <TextInput
          value={value}
          onUpdate={setValue}
          onKeyDown={handleKeyDown}
          placeholder="Значение"
          type="password"
          hasClear
          size="l"
        />
        <TextInput
          value={description}
          onUpdate={setDescription}
          onKeyDown={handleKeyDown}
          placeholder="Описание (опционально)"
          size="l"
        />
        <Button view="action" size="l" loading={isSaving} disabled={!canSubmit} onClick={() => void handleCreate()}>
          Добавить
        </Button>
      </div>

      {createError && <Alert theme="danger" view="filled" message={createError} onClose={() => setCreateError(null)} />}
    </Card>
  );
}
