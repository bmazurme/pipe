import { ChangeEvent, useRef, useState } from 'react';
import { Alert, Button } from '@gravity-ui/uikit';

import { useCreateSecretMutation } from '../../store/api';
import styles from '../SecretsPage.module.css';
import { parseEnvFile } from './parseEnvFile';

export function ImportEnvButton() {
  const [createSecretTrigger] = useCreateSecretMutation();
  const [isImporting, setIsImporting] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setSummary(null);
    setError(null);
    setIsImporting(true);
    try {
      let text: string;
      try {
        text = await file.text();
      } catch {
        setError('Не удалось прочитать файл');
        return;
      }
      const { entries, invalidLines } = parseEnvFile(text);

      let imported = 0;
      let skipped = 0;
      for (const entry of entries) {
        try {
          await createSecretTrigger({ name: entry.name, value: entry.value }).unwrap();
          imported += 1;
        } catch {
          skipped += 1;
        }
      }

      setSummary(
        `Импортировано: ${imported}, пропущено: ${skipped}` +
          (invalidLines.length > 0 ? `, строк не распознано: ${invalidLines.length}` : ''),
      );
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className={styles.importRow}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".env,text/plain"
        hidden
        data-testid="import-env-input"
        onChange={(event) => void handleFile(event)}
      />
      <Button view="outlined" size="l" loading={isImporting} disabled={isImporting} onClick={() => fileInputRef.current?.click()}>
        Импорт из .env
      </Button>
      {summary && <Alert theme="info" view="filled" message={summary} onClose={() => setSummary(null)} />}
      {error && <Alert theme="danger" view="filled" message={error} onClose={() => setError(null)} />}
    </div>
  );
}
