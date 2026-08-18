import { useState } from 'react';
import { Alert, Card } from '@gravity-ui/uikit';

import { useIsMobile } from '../shared/lib/useIsMobile';
import {
  getErrorMessage,
  StoredFileMeta,
  useDownloadFileMutation,
  useListFilesQuery,
  useUploadFileMutation,
} from '../store/api';
import { useAppSelector } from '../store/hooks';
import { storageFilesSelector } from '../store/slices';
import { PageHeader } from '../widgets/PageHeader';
import { StorageDropzone } from './storage/StorageDropzone';
import { StorageFileList } from './storage/StorageFileList';
import styles from './StoragePage.module.css';

const FILES_POLL_INTERVAL_MS = 4000;

export function StoragePage() {
  // Picks up files uploaded from another open device/tab — RTK Query's
  // structural sharing means a poll that finds nothing new doesn't cause a
  // re-render on its own.
  const { isLoading } = useListFilesQuery(undefined, {
    pollingInterval: FILES_POLL_INTERVAL_MS,
  });
  const files = useAppSelector(storageFilesSelector);
  const [uploadFile, { isLoading: isUploading }] = useUploadFileMutation();
  const [downloadFile] = useDownloadFileMutation();
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isMobile = useIsMobile();

  const handleUpload = async (file: File) => {
    setError(null);
    try {
      await uploadFile(file).unwrap();
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось загрузить файл'));
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

      <StorageDropzone isUploading={isUploading} onUpload={(file) => void handleUpload(file)} />

      {error && (
        <Alert
          theme="danger"
          view="filled"
          message={error}
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
