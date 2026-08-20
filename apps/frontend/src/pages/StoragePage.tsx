import { useState } from 'react';
import { Alert, Card } from '@gravity-ui/uikit';

import { useIsMobile } from '../shared/lib/useIsMobile';
import {
  StoredFileMeta,
  useDownloadFileMutation,
  useListFilesQuery,
} from '../store/api';
import { storageApiEndpoints } from '../store/api/storage-api/endpoints';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { storageFilesSelector } from '../store/slices';
import { PageHeader } from '../widgets/PageHeader';
import { StorageDropzone, UploadProgress } from './storage/StorageDropzone';
import { StorageFileList } from './storage/StorageFileList';
import { StorageProjectUpload } from './storage/StorageProjectUpload';
import { uploadWithProgress } from './storage/uploadWithProgress';
import styles from './StoragePage.module.css';

const FILES_POLL_INTERVAL_MS = 4000;

export function StoragePage() {
  const dispatch = useAppDispatch();
  // Picks up files uploaded from another open device/tab — RTK Query's
  // structural sharing means a poll that finds nothing new doesn't cause a
  // re-render on its own.
  const { isLoading } = useListFilesQuery(undefined, {
    pollingInterval: FILES_POLL_INTERVAL_MS,
  });
  const files = useAppSelector(storageFilesSelector);
  const accessToken = useAppSelector((state) => state.auth.accessToken);
  const [downloadFile] = useDownloadFileMutation();
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const isMobile = useIsMobile();

  // Sequential rather than parallel: these are big files on one connection,
  // so uploading them at once would just split the same bandwidth and make
  // every individual progress bar crawl.
  const handleUpload = async (selected: File[]) => {
    setError(null);
    const failures: string[] = [];

    for (const [index, file] of selected.entries()) {
      setUpload({
        name: file.name,
        index: index + 1,
        total: selected.length,
        percent: 0,
      });

      try {
        await uploadWithProgress(file, file.name, accessToken, (fraction) =>
          setUpload((current) =>
            current && { ...current, percent: Math.round(fraction * 100) },
          ),
        );
      } catch (err) {
        failures.push(
          err instanceof Error ? err.message : `Не удалось загрузить «${file.name}»`,
        );
      }
    }

    setUpload(null);
    // One refresh at the end — the list is polled anyway, and invalidating
    // per file would fire a request between each upload.
    dispatch(storageApiEndpoints.util.invalidateTags(['Storage']));

    if (failures.length > 0) {
      setError(failures.join('\n'));
    }
  };

  const handleDownload = async (file: StoredFileMeta) => {
    setError(null);
    setDownloadingId(file.id);
    try {
      await downloadFile(file).unwrap();
    } catch {
      setError('Не удалось скачать файл');
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title="Storage"
        description="Быстрый обмен файлами между вашими устройствами."
      />

      <StorageDropzone upload={upload} onUpload={(selected) => void handleUpload(selected)} />

      <StorageProjectUpload onError={setError} />

      {error && (
        <Alert
          theme="danger"
          view="filled"
          message={error}
          className={styles.errorAlert}
          onClose={() => setError(null)}
        />
      )}

      <Card view="outlined" className={styles.filesCard}>
        <StorageFileList
          files={files}
          isLoading={isLoading}
          isMobile={isMobile}
          downloadingId={downloadingId}
          onDownload={(file) => void handleDownload(file)}
        />
      </Card>
    </div>
  );
}
