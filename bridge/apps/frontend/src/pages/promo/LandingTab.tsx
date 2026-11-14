import { useRef, useState } from 'react';
import { Alert, Button, Card, Label, Skeleton, Text } from '@gravity-ui/uikit';
import { Plus } from '@gravity-ui/icons';

import { formatBytes } from '../../shared/lib/formatBytes';
import { formatDateTime } from '../../shared/lib/formatRelativeTime';
import {
  describeApiError,
  useActivateLandingReleaseMutation,
  useDeleteLandingReleaseMutation,
  useGetPromoLandingQuery,
  useUploadLandingReleaseMutation,
} from '../../store/api';
import { EmptyState } from '../../widgets/EmptyState';
import styles from '../PromoPage.module.css';

// The landing page: upload a zip (index.html in its root), then switch it on; the same button goes back to an earlier release.
export function LandingTab() {
  const landing = useGetPromoLandingQuery();
  const [upload, uploading] = useUploadLandingReleaseMutation();
  const [activate, activating] = useActivateLandingReleaseMutation();
  const [remove] = useDeleteLandingReleaseMutation();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);

    try {
      await action();
    } catch (err) {
      setError(describeApiError(err));
    }
  };

  if (landing.isLoading) return <Skeleton style={{ height: 120 }} />;

  if (landing.error || !landing.data) {
    return <Alert theme="danger" view="filled" title="Не удалось загрузить релизы" message={describeApiError(landing.error)} />;
  }

  const { configured, url, activeDirName, releases } = landing.data;

  if (!configured) {
    return (
      <Alert
        theme="info"
        view="filled"
        title="Лендинг не настроен"
        message="На этом bridge не задан LANDING_DIR: раздел работает там, где к backend подключён volume landing_site (на проде)."
      />
    );
  }

  const external = activeDirName !== null && !releases.some((release) => release.dirName === activeDirName);

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <input
          ref={input}
          type="file"
          accept=".zip"
          hidden
          aria-label="Выбрать архив"
          onChange={(event) => {
            const file = event.target.files?.[0];

            event.target.value = '';

            if (file) void run(() => upload({ file }).unwrap());
          }}
        />
        <Button view="action" size="m" loading={uploading.isLoading} onClick={() => input.current?.click()}>
          <Button.Icon>
            <Plus />
          </Button.Icon>
          Загрузить релиз (.zip)
        </Button>
        {url && (
          <Button view="outlined" size="m" href={url} target="_blank" rel="noreferrer">
            Открыть сайт
          </Button>
        )}
      </div>

      <Text variant="body-1" color="secondary">
        Архив: index.html в корне и всё, на что он ссылается (html, css, js, картинки, шрифты woff2, mp4). До 50 МБ. Релиз загружается
        выключенным, на сайт он попадает кнопкой «Включить»; предыдущий остаётся для отката.
      </Text>

      {error && <Alert theme="danger" view="filled" message={error} onClose={() => setError(null)} />}

      {external && (
        <Alert
          theme="info"
          view="filled"
          message={`Сейчас на сайте ${activeDirName}: он выложен скриптом или остался от старой раскладки и в списке ниже не показан.`}
        />
      )}

      {releases.length === 0 ? (
        <EmptyState icon={Plus} title="Релизов нет" description="Загрузите zip с лендингом: он появится здесь выключенным." />
      ) : (
        releases.map((release) => (
          <Card key={release.id} view="outlined" className={styles.card}>
            <div className={styles.head}>
              <Text variant="subheader-2">{release.label}</Text>
              {release.active && (
                <Label theme="success" size="s">
                  на сайте
                </Label>
              )}
            </div>
            <Text variant="body-1" color="secondary">
              {release.fileCount} файлов · {formatBytes(release.sizeBytes)} · загружен {formatDateTime(release.createdAt)}
              {release.activatedAt ? ` · включён ${formatDateTime(release.activatedAt)}` : ''}
            </Text>
            <div className={styles.actions}>
              {!release.active && (
                <Button view="action" size="m" loading={activating.isLoading} onClick={() => void run(() => activate(release.id).unwrap())}>
                  Включить
                </Button>
              )}
              {!release.active && (
                <Button view="flat-danger" size="m" onClick={() => void run(() => remove(release.id).unwrap())}>
                  Удалить
                </Button>
              )}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
