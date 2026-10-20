import { useEffect, useState } from 'react';
import { TrashBin } from '@gravity-ui/icons';
import { Alert, Button, Icon, Label, Loader, Text, TextArea } from '@gravity-ui/uikit';
import { Dialog } from '../../shared/ui/Dialog';

import {
  getErrorMessage,
  useDeleteJobMutation,
  useDownloadJobResultMutation,
  useGetJobQuery,
  usePeekJobResultMutation,
} from '../../store/api';
import { jobDuration } from '../../shared/lib/formatDuration';
import { useNow } from '../../shared/hooks/useNow';
import { encryptParcel, triggerBlobDownload } from '../../shared/lib/parcelCrypto';
import { useParcelKeys } from '../../shared/lib/parcelKeys';
import { ParcelKeyPicker } from '../../widgets/ParcelKeyPicker';
import styles from '../WorkerPage.module.css';
import { describeUsage } from './claudeLimits';
import { CancelJobButton } from './CancelJobButton';
import { JobLogs } from './JobLogs';
import { describeOutcome, describeStage } from './jobStage';
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
  const jobIsActive = job ? isActive(job.status) : true;
  // Ticks each second while the job runs, so the elapsed time and the wait are live between the (slower) polls.
  const now = useNow(jobIsActive ? 1000 : 0);

  // A finished job never changes again — stop polling it instead of hitting
  // the API every few seconds for as long as the dialog stays open.
  useEffect(() => {
    setPollingInterval(jobIsActive ? JOB_POLL_INTERVAL_MS : 0);
  }, [jobIsActive]);

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
      <Dialog open onClose={onClose} maxWidth="l" fullWidth aria-labelledby="job-detail-title">
        <Dialog.Header caption={`Задача #${jobId}`} id="job-detail-title" />
        <Dialog.Body className={styles.detailBody}>
          {isLoading && <Loader size="m" />}
          {isError && (
            <Alert theme="danger" view="filled" message={getErrorMessage(loadError, 'Не удалось загрузить задачу')} />
          )}
        </Dialog.Body>
        <Dialog.Footer textButtonCancel="Закрыть" onClickButtonCancel={onClose} />
      </Dialog>
    );
  }

  const duration = jobDuration(job, now);
  const stage = describeStage(job, now);
  const fields: { label: string; value: string }[] = [
    { label: 'Worker', value: job.workerName ?? '—' },
    job.contextName ? { label: 'Контекст', value: job.contextName } : null,
    job.taskKey ? { label: 'Задача', value: job.taskKey } : null,
    job.historyCount ? { label: 'Итоги прошлых запусков', value: String(job.historyCount) } : null,
    job.usage ? { label: 'Расход', value: describeUsage(job.usage) } : null,
  ].filter((field): field is { label: string; value: string } => field !== null);

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
    <Dialog open onClose={onClose} maxWidth="l" fullWidth aria-labelledby="job-detail-title">
      <Dialog.Header caption={`Задача #${job.id}`} id="job-detail-title" />
      <Dialog.Body className={styles.detailBody}>
        <div className={styles.detailSummary}>
          <div className={styles.detailMeta}>
            <Label theme={isStopping(job) ? 'warning' : STATUS_THEME[job.status]}>{isStopping(job) ? 'Останавливается…' : STATUS_LABEL[job.status]}</Label>
            <Text variant="subheader-2">{MODEL_OPTIONS.find((m) => m.value === job.model)?.content ?? job.model}</Text>
            {duration && (
              <Text color="secondary" className={styles.detailElapsed} aria-label="Время выполнения">
                {duration}
              </Text>
            )}
          </div>
          <Text color="secondary" className={styles.detailStage}>
            {jobIsActive && <Loader size="s" />} {stage ?? describeOutcome(job.status)}
          </Text>
          {fields.length > 0 && (
            <dl className={styles.detailFields}>
              {fields.map((field) => (
                <div key={field.label} className={styles.detailField}>
                  <dt>{field.label}</dt>
                  <dd>{field.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        {job.errorMessage && (
          <Alert theme="danger" view="filled" message={job.errorMessage} className={styles.detailError} />
        )}

        <JobLogs jobId={job.id} logs={job.logs ?? ''} active={jobIsActive} />

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
