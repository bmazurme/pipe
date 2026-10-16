import { useEffect, useRef, useState } from 'react';
import { Copy, TrashBin } from '@gravity-ui/icons';
import { Alert, Button, Dialog, Icon, Label, Loader, Text, TextArea } from '@gravity-ui/uikit';

import {
  getErrorMessage,
  useDeleteJobMutation,
  useDownloadJobResultMutation,
  useGetJobQuery,
  usePeekJobResultMutation,
} from '../../store/api';
import { jobDuration } from '../../shared/lib/formatDuration';
import { encryptParcel, triggerBlobDownload } from '../../shared/lib/parcelCrypto';
import { useParcelKeys } from '../../shared/lib/parcelKeys';
import { ParcelKeyPicker } from '../../widgets/ParcelKeyPicker';
import styles from '../WorkerPage.module.css';
import { describeUsage } from './claudeLimits';
import { CancelJobButton } from './CancelJobButton';
import { RetryJobButton } from './RetryJobButton';
import { isActive, isStopping, JOB_POLL_INTERVAL_MS, MODEL_OPTIONS, STATUS_LABEL, STATUS_THEME } from './constants';

interface JobDetailDialogProps {
  jobId: number;
  onClose: () => void;
}

export function JobDetailDialog({ jobId, onClose }: JobDetailDialogProps) {
  // Keeps polling while the job is still moving on its own — the worker
  // process updates status/logs server-side, nothing here pushes to us.
  const [pollingInterval, setPollingInterval] = useState(JOB_POLL_INTERVAL_MS);
  const { data: job, isLoading, isError, error: loadError } = useGetJobQuery(jobId, {
    pollingInterval,
    skipPollingIfUnfocused: true,
  });
  const logsRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const jobIsActive = job ? isActive(job.status) : true;
  const logsLength = job?.logs?.length ?? 0;

  // A finished job never changes again — stop polling it instead of hitting
  // the API every few seconds for as long as the dialog stays open.
  useEffect(() => {
    setPollingInterval(jobIsActive ? JOB_POLL_INTERVAL_MS : 0);
  }, [jobIsActive]);

  // Follow the tail while the job is running, like a terminal would.
  useEffect(() => {
    const element = logsRef.current;

    if (element && jobIsActive) {
      element.scrollTop = element.scrollHeight;
    }
  }, [logsLength, jobIsActive]);
  const { keys: parcelKeys } = useParcelKeys();
  const [deleteJob, { isLoading: isDeleting }] = useDeleteJobMutation();
  const [downloadResult, { isLoading: isDownloading }] = useDownloadJobResultMutation();
  const [peekJobResult] = usePeekJobResultMutation();
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const [encryptKey, setEncryptKey] = useState('');
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [encryptError, setEncryptError] = useState<string | null>(null);

  // Bridge can take a while to answer, and the job may be gone (deleted in another tab):
  // show the dialog straight away rather than letting the click look like it did nothing.
  if (!job) {
    return (
      <Dialog open onClose={onClose} maxWidth="m" aria-labelledby="job-detail-title">
        <Dialog.Header caption={`Задача #${jobId}`} id="job-detail-title" />
        <Dialog.Body>
          {isLoading && <Loader size="m" />}
          {isError && (
            <Alert theme="danger" view="filled" message={getErrorMessage(loadError, 'Не удалось загрузить задачу')} />
          )}
        </Dialog.Body>
        <Dialog.Footer textButtonCancel="Закрыть" onClickButtonCancel={onClose} />
      </Dialog>
    );
  }

  const duration = jobDuration(job);

  const handleCopyLogs = async () => {
    try {
      await navigator.clipboard.writeText(job.logs);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const canDelete = job.status !== 'claimed' && job.status !== 'running';

  const handleDelete = async () => {
    try {
      await deleteJob(job.id).unwrap();
      setConfirmingDelete(false);
      onClose();
    } catch (err) {
      // The endpoint's transformErrorResponse already reduced the error to a message.
      setConfirmingDelete(false);
      setError(typeof err === 'string' ? err : 'Не удалось удалить задачу');
    }
  };

  const handleDownloadResult = async () => {
    setError(null);

    try {
      await downloadResult(job).unwrap();
    } catch {
      setError('Не удалось скачать результат');
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
          <Label theme={isStopping(job) ? 'warning' : STATUS_THEME[job.status]}>{isStopping(job) ? 'Останавливается…' : STATUS_LABEL[job.status]}</Label>
          <Text color="secondary">
            {MODEL_OPTIONS.find((m) => m.value === job.model)?.content ?? job.model}
          </Text>
          {job.workerName && <Text color="secondary">· {job.workerName}</Text>}
          {job.contextName && <Text color="secondary">· Контекст: {job.contextName}</Text>}
          {job.historyCount ? <Text color="secondary">· Итоги прошлых запусков: {job.historyCount}</Text> : null}
          {duration && <Text color="secondary">· {duration}</Text>}
          {job.usage && <Text color="secondary">· {describeUsage(job.usage)}</Text>}
        </div>

        {job.errorMessage && (
          <Alert theme="danger" view="filled" message={job.errorMessage} className={styles.detailError} />
        )}

        <div className={styles.logsHeader}>
          <Text variant="subheader-1" className={styles.logsTitle}>Логи</Text>
          {job.logs && (
            <Button view="flat-secondary" size="s" onClick={() => void handleCopyLogs()}>
              <Icon data={Copy} size={14} />
              {copied ? 'Скопировано' : 'Копировать'}
            </Button>
          )}
        </div>
        <pre ref={logsRef} className={styles.logs}>{job.logs || '(пока пусто)'}</pre>

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
          onClickButtonApply: () => void handleDownloadResult(),
        })}
        onClickButtonCancel={onClose}
      >
        <CancelJobButton job={job} />
        <RetryJobButton job={job} />
        {canDelete && (
          <Button view="outlined-danger" onClick={() => setConfirmingDelete(true)}>
            <Icon data={TrashBin} size={16} />
            Удалить
          </Button>
        )}
      </Dialog.Footer>

      <Dialog
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        maxWidth="s"
        aria-labelledby="delete-job-title"
      >
        <Dialog.Header caption={`Удалить задачу #${job.id}?`} id="delete-job-title" />
        <Dialog.Body>Логи и результат задачи будут удалены вместе с ней.</Dialog.Body>
        <Dialog.Footer
          textButtonCancel="Отмена"
          textButtonApply="Удалить"
          propsButtonApply={{ view: 'outlined-danger', loading: isDeleting }}
          onClickButtonCancel={() => setConfirmingDelete(false)}
          onClickButtonApply={() => void handleDelete()}
        />
      </Dialog>
    </Dialog>
  );
}
