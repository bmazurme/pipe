import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, TextInput } from '@gravity-ui/uikit';

import { useCreateEntryMutation } from '../../store/api';
import { useAppSelector } from '../../store/hooks';
import { purgeEntriesSelector } from '../../store/slices';
import styles from '../PurgePage.module.css';
import { suggestUniqueValue } from './purgeUtils';

interface AddEntryFormProps {
  showKeys: boolean;
}

export function AddEntryForm({ showKeys }: AddEntryFormProps) {
  const entries = useAppSelector(purgeEntriesSelector);
  const [createEntryTrigger, { isLoading: isSaving }] = useCreateEntryMutation();

  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [isValueTouched, setIsValueTouched] = useState(false);
  const [dictError, setDictError] = useState<string | null>(null);

  const newKeyInputRef = useRef<HTMLInputElement>(null);

  // The tab mounts only once it becomes active, so this fires exactly when
  // the user arrives — whether by switching tabs or by opening the tab's URL.
  useEffect(() => {
    newKeyInputRef.current?.focus();
  }, []);

  const handleKeyChange = (value: string) => {
    setNewKey(value);

    // Keep proposing a fresh same-length value as the key changes, but only
    // until the user actually edits the value field themselves.
    if (!isValueTouched) {
      if (!value) {
        setNewValue('');
      } else {
        const takenValues = new Set(entries.map((entry) => entry.value));
        setNewValue(suggestUniqueValue(value.length, takenValues));
      }
    }
  };

  const handleAddEntry = async () => {
    const key = newKey.trim();
    const value = newValue.trim();
    if (!key || !value) return;

    setDictError(null);

    try {
      await createEntryTrigger({ key, value }).unwrap();
      setNewKey('');
      setNewValue('');
      setIsValueTouched(false);
    } catch (err) {
      setDictError(typeof err === 'string' ? err : 'Не удалось добавить запись');
    }
  };

  const handleAddFormKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && newKey.trim() && newValue.trim() && !isSaving) {
      event.preventDefault();
      void handleAddEntry();
    }
  };

  return (
    <Card view="outlined" className={styles.card}>
      <div className={styles.addForm}>
        <TextInput
          controlRef={newKeyInputRef}
          value={newKey}
          onUpdate={handleKeyChange}
          onKeyDown={handleAddFormKeyDown}
          placeholder="Ключ"
          type={showKeys ? 'text' : 'password'}
          size="l"
        />
        <TextInput
          value={newValue}
          onUpdate={(value) => {
            setNewValue(value);
            setIsValueTouched(true);
          }}
          onKeyDown={handleAddFormKeyDown}
          placeholder="Значение"
          size="l"
        />
        <Button
          view="action"
          size="l"
          loading={isSaving}
          disabled={!newKey.trim() || !newValue.trim()}
          onClick={() => void handleAddEntry()}
        >
          Добавить
        </Button>
      </div>

      {dictError && (
        <Alert
          theme="danger"
          view="filled"
          message={dictError}
          onClose={() => setDictError(null)}
        />
      )}
    </Card>
  );
}
