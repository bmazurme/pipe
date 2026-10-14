import { useEffect, useState } from 'react';
import { CircleCheckFill } from '@gravity-ui/icons';
import { Alert, Button, ClipboardButton, Icon, Loader, SegmentedRadioGroup, Text } from '@gravity-ui/uikit';

import {
  API_URL,
  type CreatedFleetWorker,
  useListWorkersQuery,
  useRenewWorkerEnrollmentMutation,
} from '../../store/api';
import styles from '../WorkerPage.module.css';
import { enrollSnippets } from './fleet';

type Method = 'docker' | 'exec' | 'node';

const METHODS: { value: Method; content: string }[] = [
  { value: 'docker', content: 'Docker' },
  { value: 'exec', content: 'Уже запущен' },
  { value: 'node', content: 'Без Docker' },
];

const METHOD_HINT: Record<Method, string> = {
  docker: 'На любом сервере с Docker: одна команда запускает worker и сразу подключает его.',
  exec: 'Worker уже работает (например, в Swarm), но ещё не подключён — передайте ему код. Через stdin: в истории команд кода не останется.',
  node: 'Из чекаута репозитория (после npm install и сборки): запуск без контейнера.',
};

function minutesLeft(expiresAt: string, now: number): number {
  return Math.ceil((new Date(expiresAt).getTime() - now) / 60_000);
}

interface EnrollInstructionsProps {
  workerId: number;
  workerName: string;
  code: string;
  expiresAt: string;
  /** A new code was issued (the old one no longer works). */
  onRenewed: (created: CreatedFleetWorker) => void;
}

// What to run, and the live answer to "did it connect?" — the page keeps listing workers every few seconds, so the moment the
// worker redeems the code this switches to "connected" by itself.
export function EnrollInstructions({ workerId, workerName, code, expiresAt, onRenewed }: EnrollInstructionsProps) {
  const [method, setMethod] = useState<Method>('docker');
  const [now, setNow] = useState(() => Date.now());
  const [pollingInterval, setPollingInterval] = useState(3000);
  const { data: workers } = useListWorkersQuery(undefined, {
    pollingInterval,
    skipPollingIfUnfocused: true,
  });
  const [renew, { isLoading: isRenewing }] = useRenewWorkerEnrollmentMutation();
  const [renewError, setRenewError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);

    return () => clearInterval(timer);
  }, []);

  const worker = workers?.find((candidate) => candidate.id === workerId);
  const isConnected = worker !== undefined && worker.state !== 'pending';

  useEffect(() => {
    if (isConnected) {
      setPollingInterval(0);
    }
  }, [isConnected]);
  const left = minutesLeft(expiresAt, now);
  const isExpired = left <= 0;
  const snippets = enrollSnippets(API_URL, code);

  const handleRenew = async () => {
    setRenewError(null);

    try {
      onRenewed(await renew(workerId).unwrap());
    } catch {
      setRenewError('Не удалось получить новый код');
    }
  };

  if (isConnected) {
    return (
      <div className={styles.dialogForm} role="status">
        <Alert
          theme="success"
          view="filled"
          icon={<Icon data={CircleCheckFill} size={16} />}
          title={`«${workerName}» подключён`}
          message="Он уже опрашивает bridge. Ключ хранится только на самом worker'е, в переменных среды секретов нет."
        />
      </div>
    );
  }

  return (
    <div className={styles.dialogForm}>
      <Text color="secondary">
        Одноразовый код для «{workerName}». Он действует {isExpired ? 'уже не действует' : `ещё ~${left} мин`} и
        подходит один раз.
      </Text>

      <div className={styles.enrollCode}>
        <Text variant="code-2">{code}</Text>
        <ClipboardButton
          text={code}
          size="s"
          view="outlined"
          tooltipInitialText="Скопировать код"
          tooltipSuccessText="Скопировано"
        />
      </div>

      <SegmentedRadioGroup
        size="m"
        value={method}
        onUpdate={(value) => setMethod(value as Method)}
        options={METHODS}
        aria-label="Как подключить worker"
      />
      <Text color="secondary" variant="caption-2">
        {METHOD_HINT[method]}
      </Text>

      <div className={styles.codeRow}>
        <pre className={styles.codeBlock} aria-label="Команда подключения">
          {snippets[method]}
        </pre>
        <ClipboardButton
          text={snippets[method]}
          size="s"
          view="flat-secondary"
          tooltipInitialText="Скопировать команду"
          tooltipSuccessText="Скопировано"
        />
      </div>

      {isExpired ? (
        <Alert
          theme="warning"
          view="filled"
          title="Код истёк"
          message="Получите новый и используйте его."
          actions={
            <Button size="s" view="action" loading={isRenewing} onClick={() => void handleRenew()}>
              Получить новый код
            </Button>
          }
        />
      ) : (
        <div className={styles.statusRow} role="status">
          <Loader size="s" />
          <Text color="secondary">Ждём, пока worker подключится…</Text>
        </div>
      )}

      {renewError && <Alert theme="danger" view="filled" message={renewError} />}
    </div>
  );
}
