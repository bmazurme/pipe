import { useState } from 'react';
import { TrashBin } from '@gravity-ui/icons';
import { Alert, Button, Dialog, Icon, Label, Text, TextArea } from '@gravity-ui/uikit';

import {
  useDeleteJobMutation,
  useDownloadJobResultMutation,
  useGetJobQuery,
  usePeekJobResultMutation,
} from '../../store/api';
import { encryptParcel, triggerBlobDownload } from '../../shared/lib/parcelCrypto';
import { useParcelKeys } from '../../shared/lib/parcelKeys';
import { ParcelKeyPicker } from '../../widgets/ParcelKeyPicker';
import styles from '../WorkerPage.module.css';
import { JOB_POLL_INTERVAL_MS, MODEL_OPTIONS, STATUS_LABEL, STATUS_THEME } from './constants';

interface JobDetailDialogProps {
  jobId: number;
  onClose: () => void;
}

export function JobDetailDialog({ jobId, onClose }: JobDetailDialogProps) {
  // Keeps polling while the job is still moving on its own — the worker
  // process updates status/logs server-side, nothing here pushes to us.
  const { data: job } = useGetJobQuery(jobId, {
    pollingInterval: JOB_POLL_INTERVAL_MS,
  });
  const { keys: parcelKeys } = useParcelKeys();
  const [deleteJob, { isLoading: isDeleting }] = useDeleteJobMutation();
  const [downloadResult, { isLoading: isDownloading }] = useDownloadJobResultMutation();
  const [peekJobResult] = usePeekJobResultMutation();
  const [error, setError] = useState<string | null>(null);

  const [encryptKey, setEncryptKey] = useState('');
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [encryptError, setEncryptError] = useState<string | null>(null);

  if (!job) return null;

  const canDelete = job.status !== 'claimed' && job.status !== 'running';

  const handleDelete = async () => {
    try {
      await deleteJob(job.id).unwrap();
      onClose();
    } catch (err) {
      setError((err as { data?: { message?: string } })?.data?.message ?? 'Не удалось удалить задачу');
    }
  };

  // Encrypts client-side, same as the decrypt-before-job-creation flow
  // below — bridge/worker never see the key or the plaintext-vs-ciphertext
  // distinction, only ever the result's own already-plaintext bytes.
  const handleDownloadEncrypted = async () => {
    if (!encryptKey.trim()) return;
    setEncryptError(null);
    setIsEncrypting(true);

    try {
      const plain = await peekJobResult(job.id).unwrap();
      const encrypted = await encryptParcel(plain, encryptKey.trim());
      triggerBlobDownload(encrypted, `result-${job.id}.zip.enc`);
    } catch (err) {
      setEncryptError(err instanceof Error ? err.message : 'Не удалось зашифровать результат');
    } finally {
      setIsEncrypting(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="m" aria-labelledby="job-detail-title">
      <Dialog.Header caption={`Задача #${job.id}`} id="job-detail-title" />
      <Dialog.Body>
        <div className={styles.detailMeta}>
          <Label theme={STATUS_THEME[job.status]}>{STATUS_LABEL[job.status]}</Label>
          <Text color="secondary">
            {MODEL_OPTIONS.find((m) => m.value === job.model)?.content ?? job.model}
          </Text>
          {job.workerName && <Text color="secondary">· {job.workerName}</Text>}
        </div>

        {job.errorMessage && (
          <Alert theme="danger" view="filled" message={job.errorMessage} className={styles.detailError} />
        )}

        <Text variant="subheader-1" className={styles.logsTitle}>Логи</Text>
        <pre className={styles.logs}>{job.logs || '(пока пусто)'}</pre>

        {job.status === 'succeeded' && (
          <div className={styles.encryptSection}>
            <Text variant="body-2" color="secondary">
              Публичный ключ получателя — чтобы скачать результат зашифрованным, а не в открытом виде
            </Text>
            <ParcelKeyPicker keys={parcelKeys} onPick={setEncryptKey} />
            <div className={styles.encryptRow}>
              <TextArea value={encryptKey} onUpdate={setEncryptKey} rows={2} placeholder="-----BEGIN PUBLIC KEY-----" />
              <Button
                view="outlined"
                loading={isEncrypting}
                disabled={!encryptKey.trim()}
                onClick={() => void handleDownloadEncrypted()}
              >
                Скачать зашифрованным
              </Button>
            </div>
            {encryptError && <Alert theme="danger" view="filled" message={encryptError} />}
          </div>
        )}

        {error && <Alert theme="danger" view="filled" message={error} className={styles.detailError} />}
      </Dialog.Body>
      <Dialog.Footer
        textButtonCancel="Закрыть"
        {...(job.status === 'succeeded' && {
          textButtonApply: 'Скачать результат',
          propsButtonApply: { loading: isDownloading },
          onClickButtonApply: () => void downloadResult(job),
        })}
        onClickButtonCancel={onClose}
      >
        {canDelete && (
          <Button view="outlined-danger" onClick={() => void handleDelete()} loading={isDeleting}>
            <Icon data={TrashBin} size={16} />
            Удалить
          </Button>
        )}
      </Dialog.Footer>
    </Dialog>
  );
}
