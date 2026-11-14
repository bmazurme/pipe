import { useRef, useState } from 'react';
import { Alert, Button, Card, Skeleton, Text } from '@gravity-ui/uikit';
import { Plus } from '@gravity-ui/icons';

import { formatDateTime } from '../../shared/lib/formatRelativeTime';
import { formatBytes } from '../../shared/lib/formatBytes';
import {
  describeApiError,
  type PromoAsset,
  useDeletePromoAssetMutation,
  useListPromoAssetsQuery,
  useUploadPromoAssetMutation,
} from '../../store/api';
import { useAppSelector } from '../../store/hooks';
import { EmptyState } from '../../widgets/EmptyState';
import styles from '../PromoPage.module.css';
import { fetchAssetBlobUrl } from './assetBlob';

const ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.mp4,.mov,.webm';

// The pictures and videos the posts carry (up to 200 MB each).
export function AssetsTab() {
  const assets = useListPromoAssetsQuery();
  const [upload, uploading] = useUploadPromoAssetMutation();
  const [remove] = useDeletePromoAssetMutation();
  const accessToken = useAppSelector((state) => state.auth.accessToken);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);

    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : describeApiError(err));
    }
  };

  const open = (asset: PromoAsset) =>
    run(async () => {
      const url = await fetchAssetBlobUrl(asset.id, accessToken);

      window.open(url, '_blank', 'noopener');
    });

  if (assets.isLoading) return <Skeleton style={{ height: 120 }} />;

  if (assets.error || !assets.data) {
    return <Alert theme="danger" view="filled" title="Не удалось загрузить файлы" message={describeApiError(assets.error)} />;
  }

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          hidden
          aria-label="Выбрать файл"
          onChange={(event) => {
            const file = event.target.files?.[0];

            event.target.value = '';

            if (file) void run(() => upload(file).unwrap());
          }}
        />
        <Button view="action" size="m" loading={uploading.isLoading} onClick={() => input.current?.click()}>
          <Button.Icon>
            <Plus />
          </Button.Icon>
          Загрузить файл
        </Button>
      </div>

      {error && <Alert theme="danger" view="filled" message={error} onClose={() => setError(null)} />}

      {assets.data.length === 0 ? (
        <EmptyState icon={Plus} title="Файлов нет" description="Картинки и видео для постов: png, jpg, webp, gif, mp4, mov, webm, до 200 МБ." />
      ) : (
        assets.data.map((asset) => (
          <Card key={asset.id} view="outlined" className={styles.card}>
            <div className={styles.head}>
              <Text variant="subheader-2">{asset.originalName}</Text>
            </div>
            <Text variant="body-1" color="secondary">
              {asset.mime} · {formatBytes(asset.size)} · {formatDateTime(asset.createdAt)}
            </Text>
            <div className={styles.actions}>
              <Button view="outlined" size="m" onClick={() => void open(asset)}>
                Открыть
              </Button>
              <Button view="flat-danger" size="m" onClick={() => void run(() => remove(asset.id).unwrap())}>
                Удалить
              </Button>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
