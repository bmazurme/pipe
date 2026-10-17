import { ArrowDownToSquare } from '@gravity-ui/icons';
import { Alert, Button, Card, Icon, Text } from '@gravity-ui/uikit';

import { describeApiError, useDownloadReportsReleaseMutation, useGetReportsReleaseInfoQuery } from '../../store/api';
import { useIsNonOwner } from '../../store/hooks';
import { OwnerOnlyNotice } from '../../widgets/OwnerOnly';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../ReportsPage.module.css';

export function ReportsReleaseSection() {
  // Both routes are owner-only: another account gets the notice and no request that is bound to fail.
  const isNonOwner = useIsNonOwner();
  const { data: info, isError: isInfoError } = useGetReportsReleaseInfoQuery(undefined, { skip: isNonOwner });
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
            После распаковки: npm install && npm run build в packages/protocol, затем
            npm install && npm start в reports. Доступно только владельцу развёртывания.
          </Text>
          {info && (
            <Text variant="caption-2" color="secondary">
              Последний коммит main: {info.shortSha}
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
