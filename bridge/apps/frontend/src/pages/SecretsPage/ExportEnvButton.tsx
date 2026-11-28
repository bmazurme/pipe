import { useState } from 'react';
import { Alert, Button } from '@gravity-ui/uikit';

import { useLazyExportSecretsQuery, useListSecretsQuery } from '../../store/api';
import styles from './SecretsPage.module.css';

export function ExportEnvButton() {
  const { data: secrets } = useListSecretsQuery();
  const [exportSecrets, { isFetching }] = useLazyExportSecretsQuery();
  const [error, setError] = useState<string | null>(null);
  // The file holds every secret in the clear — one more click, with what that means, before it is made.
  const [confirming, setConfirming] = useState(false);

  const handleDownload = async () => {
    setError(null);
    setConfirming(false);
    const result = await exportSecrets();
    if (result.data === undefined) {
      setError('Не удалось скачать .env');
      return;
    }
    const url = URL.createObjectURL(new Blob([result.data], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'secrets.env';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={styles.importRow}>
      <Button
        view="outlined"
        size="l"
        loading={isFetching}
        disabled={isFetching || !secrets || secrets.length === 0 || confirming}
        onClick={() => setConfirming(true)}
      >
        Скачать .env
      </Button>
      {confirming && (
        <Alert
          theme="warning"
          view="filled"
          title={`В файле значения секретов в открытом виде (${secrets?.length ?? 0})`}
          message="Не отправляйте его в чат, задачу или репозиторий, не прикладывайте к посылке и удалите после использования."
          actions={
            <div className={styles.importRow}>
              <Button view="normal" size="s" onClick={() => void handleDownload()}>
                Всё равно скачать
              </Button>
              <Button view="flat" size="s" onClick={() => setConfirming(false)}>
                Отмена
              </Button>
            </div>
          }
          onClose={() => setConfirming(false)}
        />
      )}
      {error && <Alert theme="danger" view="filled" message={error} onClose={() => setError(null)} />}
    </div>
  );
}
