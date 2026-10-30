import { useState } from 'react';
import { Alert, Button } from '@gravity-ui/uikit';

import { useLazyExportSecretsQuery, useListSecretsQuery } from '../../store/api';
import styles from '../SecretsPage.module.css';

export function ExportEnvButton() {
  const { data: secrets } = useListSecretsQuery();
  const [exportSecrets, { isFetching }] = useLazyExportSecretsQuery();
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setError(null);
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
        disabled={isFetching || !secrets || secrets.length === 0}
        onClick={() => void handleClick()}
      >
        Скачать .env
      </Button>
      {error && <Alert theme="danger" view="filled" message={error} onClose={() => setError(null)} />}
    </div>
  );
}
