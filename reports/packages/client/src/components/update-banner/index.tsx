import { useEffect, useState } from 'react';
import { Alert, Button, Loader } from '@gravity-ui/uikit';

import {
  useApplyUpdateMutation,
  useGetUpdateProgressQuery,
  useGetUpdateStatusQuery,
  useLazyGetUpdateStatusQuery,
} from '../../store/api';
import { describeError } from '../../utils/describe-error';

import { bannerState } from './banner-state';
import { describeRelease } from './describe-release';

import style from './update-banner.module.css';

// Half the time the server remembers an answer for — a page left open for days still learns about a release.
const POLL_MS = 30 * 60 * 1000;
const PROGRESS_POLL_MS = 2000;

// "A new version of reports is available", with the button that brings it, and what the update is doing while it runs.
function UpdateBanner() {
  const { data: status, error: statusError } = useGetUpdateStatusQuery(undefined, { pollingInterval: POLL_MS, skipPollingIfUnfocused: true });
  // Cheap (a file read on the server), so it is always asked — an update started in another tab or by hand shows here too.
  const { data: progress } = useGetUpdateProgressQuery(undefined, { pollingInterval: PROGRESS_POLL_MS });
  const [check, { isFetching }] = useLazyGetUpdateStatusQuery();
  const [apply, { isLoading: isStarting }] = useApplyUpdateMutation();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  // The banner depends on how long ago the update last moved, so the clock has to tick for it to notice a stalled one.
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), PROGRESS_POLL_MS);

    return () => clearInterval(timer);
  }, []);

  const state = bannerState(status, progress, now, statusError ? describeError(statusError, 'Не удалось проверить обновления') : null);
  const latest = status?.latest ?? null;

  const handleUpdate = async () => {
    setStartError(null);

    try {
      await apply().unwrap();
    } catch (error) {
      setStartError(describeError(error, 'Не удалось начать обновление'));
    }
  };

  if (state.kind === 'none') return null;

  if (state.kind === 'running') {
    return (
      <div className={style.banner}>
        <Alert
          theme="info"
          view="filled"
          title="Обновляю reports"
          message={(
            <span className={style.running}>
              <Loader size="s" />
              {state.message}
              {' '}Не закрывайте это окно: сервер может перезапуститься.
            </span>
          )}
        />
      </div>
    );
  }

  if (state.kind === 'done') {
    return (
      <div className={style.banner}>
        <Alert
          theme="success"
          view="filled"
          title="reports обновлён"
          message={`${state.message} Ваши настройки и .env не тронуты.`}
          actions={(
            <Button view="outlined" size="s" onClick={() => window.location.reload()}>
              Обновить страницу
            </Button>
          )}
        />
      </div>
    );
  }

  if (state.kind === 'check-failed') {
    return (
      <div className={style.banner}>
        <Alert
          theme="warning"
          view="filled"
          title="Не удалось проверить обновления"
          message={state.message}
          actions={(
            <Button view="outlined" size="s" loading={isFetching} onClick={() => void check({ refresh: true })}>
              Проверить снова
            </Button>
          )}
        />
      </div>
    );
  }

  if (state.kind === 'failed') {
    return (
      <div className={style.banner}>
        <Alert
          theme="danger"
          view="filled"
          title={state.rolledBack ? 'Обновление не удалось — прежняя версия возвращена' : 'Обновление не удалось'}
          message={state.message}
          actions={(
            <Button view="outlined" size="s" loading={isStarting} onClick={() => void handleUpdate()}>
              Повторить
            </Button>
          )}
        />
      </div>
    );
  }

  if (!latest || dismissed === latest.releaseId) return null;

  return (
    <div className={style.banner}>
      <Alert
        theme="info"
        view="filled"
        title="Доступна новая версия reports"
        message={(
          <>
            Новая: {describeRelease(latest)}. У вас: {describeRelease(status?.current ?? null)}.
            {state.canUpdate
              ? ' Ваши настройки и .env при обновлении не меняются.'
              : ` Обновить кнопкой нельзя: ${state.blockedReason ?? 'самообновление недоступно'}.`}
            {startError && <span className={style.error}> {startError}</span>}
          </>
        )}
        actions={(
          <>
            {state.canUpdate && (
              <Button view="action" size="s" loading={isStarting} onClick={() => void handleUpdate()}>
                Обновить
              </Button>
            )}
            <Button view="outlined" size="s" loading={isFetching} onClick={() => void check({ refresh: true })}>
              Проверить снова
            </Button>
          </>
        )}
        onClose={() => setDismissed(latest.releaseId)}
      />
    </div>
  );
}

export default UpdateBanner;
