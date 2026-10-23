import { ArrowDownToSquare } from '@gravity-ui/icons';
import { Alert, Button, Card, Icon, Text } from '@gravity-ui/uikit';

import { describeApiError, useDownloadReportsReleaseMutation, useGetReportsInstalledQuery, useGetReportsReleaseInfoQuery } from '../../store/api';
import { useIsNonOwner } from '../../store/hooks';
import { OwnerOnlyNotice } from '../../widgets/OwnerOnly';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../ReportsPage.module.css';

function describeAgo(iso: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));

  return `${minutes} мин назад`;
}

export function ReportsReleaseSection() {
  // Both routes are owner-only: another account gets the notice and no request that is bound to fail.
  const isNonOwner = useIsNonOwner();
  const { data: info, isError: isInfoError } = useGetReportsReleaseInfoQuery(undefined, { skip: isNonOwner });
  const { data: installed } = useGetReportsInstalledQuery(undefined, { skip: isNonOwner });
  const [download, { isLoading: isDownloading, error: downloadError }] = useDownloadReportsReleaseMutation();

  if (isNonOwner) {
    return (
      <Card view="outlined" className={styles.card}>
        <SectionHeader title="Скачать reports" />
        <OwnerOnlyNotice />
      </Card>
    );
  }

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader title="Скачать reports" />

      <div className={styles.row}>
        <div className={styles.meta}>
          <Text variant="body-2" color="secondary">
            reports/ и packages/protocol/ из ветки main, в виде zip — все зависимости внутри.
            После распаковки: npm install && npm start в папке reports (packages/protocol при первой
            установке соберётся сам). Доступно только владельцу развёртывания.
          </Text>
          {info && (
            <Text variant="caption-2" color="secondary">
              {info.version ? `Версия ${info.version} · ` : ''}сборка {info.shortId} · из коммита main {info.shortSha}
            </Text>
          )}
          {info && installed !== undefined && (
            <Text variant="caption-2" color="secondary">
              {installed
                ? `Ваш reports: сборка ${installed.shortId} — ${
                    installed.releaseId === info.releaseId ? 'актуальна' : `доступна новая сборка ${info.shortId}`
                  } · проверял обновления ${describeAgo(installed.checkedAt)}`
                : 'reports ещё не обращался к bridge'}
            </Text>
          )}
        </div>
        <Button view="action" size="l" loading={isDownloading} onClick={() => void download()}>
          <Icon data={ArrowDownToSquare} size={16} />
          Скачать zip
        </Button>
      </div>

      {isInfoError && (
        <Alert theme="danger" view="filled" message="Не удалось получить информацию о репозитории" />
      )}
      {downloadError && (
        <Alert theme="danger" view="filled" message={describeApiError(downloadError)} />
      )}
    </Card>
  );
}
