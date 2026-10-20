import { useState } from 'react';
import { Alert, Button } from '@gravity-ui/uikit';

import { useGetUpdateStatusQuery, useLazyGetUpdateStatusQuery } from '../../store/api';

import { describeRelease } from './describe-release';

import style from './update-banner.module.css';

// Half the time the server remembers an answer for — a page left open for days still learns about a release.
const POLL_MS = 30 * 60 * 1000;

// "A new version of reports is available" — shown on every page while the build running here differs from the one bridge
// offers. It only says so: how to get it is described next to it (the update itself is a separate step).
function UpdateBanner() {
  const { data } = useGetUpdateStatusQuery(undefined, { pollingInterval: POLL_MS, skipPollingIfUnfocused: true });
  const [check, { isFetching }] = useLazyGetUpdateStatusQuery();
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (!data?.updateAvailable || !data.latest || dismissed === data.latest.releaseId) return null;

  const latest = data.latest;

  return (
    <div className={style.banner}>
      <Alert
        theme="info"
        view="filled"
        title="Доступна новая версия reports"
        message={(
          <>
            Новая: {describeRelease(latest)}. У вас: {describeRelease(data.current)}.
            {' '}Скачайте свежий архив на странице Reports в bridge и обновите установку.
          </>
        )}
        actions={(
          <Button view="outlined" size="s" loading={isFetching} onClick={() => void check({ refresh: true })}>
            Проверить снова
          </Button>
        )}
        onClose={() => setDismissed(latest.releaseId)}
      />
    </div>
  );
}

export default UpdateBanner;
