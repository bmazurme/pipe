import { useState } from 'react';
import { Alert, Button } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { getErrorMessage, useGetLoopControlQuery, usePauseLoopMutation, useResumeLoopMutation } from '../../store/api';

const BY_LABEL: Record<string, string> = {
  deploy: 'остановил откат релиза',
  telegram: 'остановлено из Telegram',
  owner: 'остановлено вами',
};

// The kill-switch of the automation. While it is on, nothing starts new automatic work (scheduled analyses and runs, auto-started parcels,
// CI repairs and the like); what you do by hand, and merging, still works. Shown always, so pausing is one click from the Improve page.
export function LoopControlBanner() {
  const { data } = useGetLoopControlQuery(undefined, { pollingInterval: 30_000, skipPollingIfUnfocused: true });
  const [pause, { isLoading: isPausing }] = usePauseLoopMutation();
  const [resume, { isLoading: isResuming }] = useResumeLoopMutation();
  const [error, setError] = useState<string | null>(null);

  if (!data) return null;

  const run = async (action: () => Promise<unknown>) => {
    setError(null);

    try {
      await action();
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось переключить автоматику'));
    }
  };

  if (!data.paused) {
    return (
      <div>
        <Button view="flat" size="s" loading={isPausing} onClick={() => void run(() => pause({}).unwrap())}>
          Поставить автоматику на паузу
        </Button>
        {error && <Alert theme="danger" view="filled" message={error} />}
      </div>
    );
  }

  const meta = [data.pausedBy ? BY_LABEL[data.pausedBy] : null, data.pausedAt ? formatRelativeTime(data.pausedAt) : null].filter(Boolean).join(' · ');

  return (
    <Alert
      theme="warning"
      view="filled"
      title="Автоматика на паузе"
      message={
        <>
          {data.reason ?? 'без причины'}
          {meta && <div>{meta}</div>}
          <div>Новые анализы, расписания, автозапуск посылок и работа с открытыми PR не стартуют. Вручную запускать и вливать можно.</div>
          {error && <div>{error}</div>}
        </>
      }
      actions={
        <Button view="action" size="m" loading={isResuming} onClick={() => void run(() => resume().unwrap())}>
          Продолжить
        </Button>
      }
    />
  );
}
