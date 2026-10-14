import { useState } from 'react';
import { Alert, Button, Card, Text } from '@gravity-ui/uikit';
import { Link } from 'react-router-dom';

import { useStartImprovePrFixMutation } from '../../store/api/improve-api/endpoints';
import type { FixPrAction } from './chatActions';
import styles from './PrFixCard.module.css';

interface Props {
  action: FixPrAction;
  model: string;
  /** The person decided (started it or put it away) — the page stops offering this card. */
  onDone: () => void;
}

// What the model proposed, shown for the person to confirm: nothing is started until "Запустить".
export function PrFixCard({ action, model, onDone }: Props) {
  const [start, { isLoading }] = useStartImprovePrFixMutation();
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<number | null>(null);

  const run = async () => {
    setError(null);

    try {
      const created = await start({ prNumber: action.pr, instruction: action.instruction, model }).unwrap();

      setRunId(created.id);
    } catch (failure) {
      setError(typeof failure === 'string' ? failure : 'Не удалось запустить правку');
    }
  };

  if (runId !== null) {
    return (
      <Card view="filled" className={styles.card}>
        <Text variant="body-2">
          Правка PR #{action.pr} запущена (запуск #{runId}). Worker сделает коммит в ветку этого PR —{' '}
          <Link to="/improve">ход смотрите в Improve</Link>.
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
      <Text variant="subheader-2">Предложена правка PR #{action.pr}</Text>
      <Text variant="body-2" className={styles.instruction}>
        {action.instruction}
      </Text>
      <Text variant="caption-2" color="secondary">
        Worker внесёт это отдельным коммитом в ветку PR. Защищённые пути (.github, bridge/deploy …) он менять не будет.
      </Text>
      {error && <Alert theme="danger" message={error} />}
      <div className={styles.actions}>
        <Button view="action" size="m" loading={isLoading} onClick={run}>
          Запустить
        </Button>
        <Button view="flat" size="m" disabled={isLoading} onClick={onDone}>
          Не нужно
        </Button>
      </div>
    </Card>
  );
}
