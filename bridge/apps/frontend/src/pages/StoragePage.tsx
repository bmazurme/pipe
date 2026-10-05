import { useState } from 'react';
import { Alert, Card, Dialog, Text } from '@gravity-ui/uikit';

import { useIsMobile } from '../shared/lib/useIsMobile';
import {
  StoredFileMeta,
  useDownloadFileMutation,
  useListEntriesQuery,
  useListFilesQuery,
} from '../store/api';
import { storageApiEndpoints } from '../store/api/storage-api/endpoints';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { purgeEntriesSelector, storageFilesSelector } from '../store/slices';
import { PageHeader } from '../widgets/PageHeader';
import { OpenEncryptedFileDialog } from './storage/OpenEncryptedFileDialog';
import { ParcelKeysCard } from './storage/ParcelKeysCard';
import { FileLeakFindings, scanFilesForLeaks } from './storage/scanFileForLeaks';
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
  const [openEncryptedFile, setOpenEncryptedFile] = useState<StoredFileMeta | null>(null);
  const isMobile = useIsMobile();

  // Only the "upload a project folder" path already applies the Purge
  // dictionary (see storage/projectZip.ts) — a plain file dropped here goes
  // up untouched otherwise. This is what closes that gap: entries are needed
  // to check whether a real secret value survived unsubstituted.
  useListEntriesQuery();
  const purgeEntries = useAppSelector(purgeEntriesSelector);
  const [pendingUpload, setPendingUpload] = useState<{
    files: File[];
    findings: FileLeakFindings[];
  } | null>(null);

  // Sequential rather than parallel: these are big files on one connection,
  // so uploading them at once would just split the same bandwidth and make
  // every individual progress bar crawl.
  const startUpload = async (selected: File[]) => {
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

  // Scans before anything leaves the machine — a confirmation gate, not a
  // silent after-the-fact warning like PurgeApplyTab's, because by the time
  // an upload finishes the file has already left. Heuristic, so it's a
  // question the user answers, not a hard block.
  const handleUpload = async (selected: File[]) => {
    setError(null);
    const findings = await scanFilesForLeaks(selected, purgeEntries);

    if (findings.length > 0) {
      setPendingUpload({ files: selected, findings });
      return;
    }

    await startUpload(selected);
  };

  const handleDownload = async (file: StoredFileMeta) => {
    setError(null);
    setDownloadingId(file.id);
    try {
      await downloadFile(file).unwrap();
    } catch (err) {
      // 404 specifically now means "the record exists but the file is
      // gone from disk" (storage.controller.ts's download route used to
      // leave this case as a hung request with no response at all — see
      // its own comment) — worth telling apart from a generic failure.
      const status = (err as { status?: unknown } | undefined)?.status;
      setError(status === 404 ? 'Файл отсутствует в хранилище — запись устарела' : 'Не удалось скачать файл');
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

      <ParcelKeysCard />

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
          onOpenEncrypted={setOpenEncryptedFile}
        />
      </Card>

      {openEncryptedFile && (
        <OpenEncryptedFileDialog file={openEncryptedFile} onClose={() => setOpenEncryptedFile(null)} />
      )}

      <Dialog
        open={pendingUpload !== null}
        onClose={() => setPendingUpload(null)}
        maxWidth="s"
        aria-labelledby="leak-confirm-title"
      >
        <Dialog.Header caption="Похоже, в файлах остались секреты" id="leak-confirm-title" />
        <Dialog.Body>
          <Text color="secondary">
            Эвристическая проверка — не гарантия, но кое-что подозрительное нашла.
            Проверьте перед загрузкой:
          </Text>
          <ul className={styles.leakList}>
            {pendingUpload?.findings.map((finding) => (
              <li key={finding.source}>
                <Text variant="body-2">{finding.source}</Text>
                {finding.dictionaryHits > 0 && (
                  <Text color="warning" variant="caption-2" as="div">
                    незаменённых значений словаря: {finding.dictionaryHits}
                  </Text>
                )}
                {finding.patternFindings.map((leak, index) => (
                  <Text key={index} color="secondary" variant="caption-2" as="div">
                    {leak.kind}: {leak.match}
                  </Text>
                ))}
              </li>
            ))}
          </ul>
        </Dialog.Body>
        <Dialog.Footer
          textButtonCancel="Отмена"
          textButtonApply="Всё равно загрузить"
          onClickButtonCancel={() => setPendingUpload(null)}
          onClickButtonApply={() => {
            const selected = pendingUpload?.files ?? [];
            setPendingUpload(null);
            void startUpload(selected);
          }}
        />
      </Dialog>
    </div>
  );
}
