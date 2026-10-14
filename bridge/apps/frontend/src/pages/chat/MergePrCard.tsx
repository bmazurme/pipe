import { useState } from 'react';
import { Alert, Button, Card, Text } from '@gravity-ui/uikit';

import { useStartImprovePrMergeMutation } from '../../store/api/improve-api/endpoints';
import type { MergePrAction } from './chatActions';
import styles from './PrFixCard.module.css';

interface Props {
  action: MergePrAction;
  /** The person decided (merged it or put it away) — the page stops offering this card. */
  onDone: () => void;
}

// What the model proposed, shown for the person to confirm: nothing is merged until "Смержить".
export function MergePrCard({ action, onDone }: Props) {
  const [start, { isLoading }] = useStartImprovePrMergeMutation();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ merged: boolean; reason: string; prUrl?: string; baseRef?: string } | null>(null);

  const run = async () => {
    setError(null);

    try {
      setResult(await start({ prNumber: action.pr }).unwrap());
    } catch (failure) {
      setError(typeof failure === 'string' ? failure : 'Не удалось смержить PR');
    }
  };

  if (result?.merged) {
    return (
      <Card view="filled" className={styles.card}>
        <Text variant="body-2">
          ✅ PR #{action.pr} влит в {result.baseRef}
          {result.prUrl && (
            <>
              {' — '}
              <a href={result.prUrl} target="_blank" rel="noreferrer">
                открыть на GitHub
              </a>
            </>
          )}
        </Text>
        <div className={styles.actions}>
          <Button view="flat" size="s" onClick={onDone}>
            Закрыть
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card view="outlined" className={styles.card}>
      <Text variant="subheader-2">Предложен merge PR #{action.pr}</Text>
      <Text variant="caption-2" color="secondary">
        Bridge заново проверит, что PR открыт, CI зелёный, нет конфликтов и не затронуты защищённые пути — иначе
        откажет. Метод — squash.
      </Text>
      {result && !result.merged && <Alert theme="warning" message={result.reason} />}
      {error && <Alert theme="danger" message={error} />}
      <div className={styles.actions}>
        <Button view="action" size="m" loading={isLoading} onClick={run}>
          Смержить
        </Button>
        <Button view="flat" size="m" disabled={isLoading} onClick={onDone}>
          Не нужно
        </Button>
      </div>
    </Card>
  );
}
