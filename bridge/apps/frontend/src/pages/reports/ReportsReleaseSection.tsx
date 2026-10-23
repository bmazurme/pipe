import { ArrowDownToSquare } from '@gravity-ui/icons';
import { Alert, Button, Card, Icon, Loader, Text } from '@gravity-ui/uikit';

import { describeApiError, useDownloadReportsReleaseMutation, useGetReportsReleaseInfoQuery } from '../../store/api';
import { useIsNonOwner } from '../../store/hooks';
import { OwnerOnlyNotice } from '../../widgets/OwnerOnly';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../ReportsPage.module.css';

export function ReportsReleaseSection() {
  // Both routes are owner-only: another account gets the notice and no request that is bound to fail.
  const isNonOwner = useIsNonOwner();
  const {
    data: info,
    error: infoError,
    isFetching: isInfoFetching,
    refetch: refetchInfo,
  } = useGetReportsReleaseInfoQuery(undefined, { skip: isNonOwner });
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
          {/* A cold build answers in up to a minute: say so instead of showing nothing. */}
          {!info && !infoError && isInfoFetching && (
            <div className={styles.loading}>
              <Loader size="s" />
              <Text variant="caption-2" color="secondary">
                Проверяем сборку на bridge — первая сборка после изменений может занять до минуты…
              </Text>
            </div>
          )}
        </div>
        <Button view="action" size="l" loading={isDownloading} onClick={() => void download()}>
          <Icon data={ArrowDownToSquare} size={16} />
          Скачать zip
        </Button>
      </div>

      {infoError && !info && (
        <Alert
          theme="danger"
          view="filled"
          title="Не удалось получить информацию о репозитории"
          message={describeApiError(infoError)}
          actions={
            <Button view="outlined" size="m" loading={isInfoFetching} onClick={() => void refetchInfo()}>
              Повторить
            </Button>
          }
        />
      )}
      {downloadError && (
        <Alert theme="danger" view="filled" message={describeApiError(downloadError)} />
      )}
    </Card>
  );
}
