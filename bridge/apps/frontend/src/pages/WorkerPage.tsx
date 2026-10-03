import { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, FaceRobot, LockOpen, TrashBin } from '@gravity-ui/icons';
import {
  Alert,
  Button,
  Card,
  Dialog,
  Icon,
  Label,
  Select,
  Skeleton,
  Text,
  TextArea,
  TextInput,
} from '@gravity-ui/uikit';

import { formatRelativeTime } from '../shared/lib/formatRelativeTime';
import {
  ACTIVE_JOB_STATUSES,
  ClaudeCredential,
  StoredFileMeta,
  WorkerJob,
  WorkerJobModel,
  WorkerJobStatus,
  useActivateVpnConnectionMutation,
  useCreateClaudeCredentialMutation,
  useCreateJobMutation,
  useDeleteClaudeCredentialMutation,
  useDeleteJobMutation,
  useDownloadJobResultMutation,
  useGetJobQuery,
  useListClaudeCredentialsQuery,
  useListFilesQuery,
  useListJobsQuery,
  useListVpnConnectionsQuery,
  usePeekFileMutation,
  usePeekJobResultMutation,
  useSetWorkerSecretMutation,
  WorkerSecretName,
} from '../store/api';
import { decryptParcel, encryptParcel, isEncryptedFile, stripEncryptedSuffix, triggerBlobDownload } from '../shared/lib/parcelCrypto';
import { useParcelKeys } from '../shared/lib/parcelKeys';
import { useAppSelector } from '../store/hooks';
import { EmptyState } from '../widgets/EmptyState';
import { PageHeader } from '../widgets/PageHeader';
import { ParcelKeyPicker } from '../widgets/ParcelKeyPicker';
import { SectionHeader } from '../widgets/SectionHeader';
import { uploadWithProgress } from './storage/uploadWithProgress';
import styles from './WorkerPage.module.css';

const JOB_POLL_INTERVAL_MS = 3000;

const MODEL_OPTIONS: { value: WorkerJobModel; content: string }[] = [
  { value: 'sonnet', content: 'Claude Sonnet' },
  { value: 'opus', content: 'Claude Opus' },
  { value: 'gpt', content: 'GPT' },
  { value: 'deepseek', content: 'DeepSeek' },
  { value: 'qwen', content: 'Qwen' },
];

const STATUS_LABEL: Record<WorkerJobStatus, string> = {
  queued: 'В очереди',
  claimed: 'Взята воркером',
  running: 'Выполняется',
  succeeded: 'Готово',
  failed: 'Ошибка',
};

const STATUS_THEME: Record<WorkerJobStatus, 'normal' | 'info' | 'success' | 'danger'> = {
  queued: 'normal',
  claimed: 'info',
  running: 'info',
  succeeded: 'success',
  failed: 'danger',
};

function isActive(status: WorkerJobStatus): boolean {
  return ACTIVE_JOB_STATUSES.includes(status);
}

function VpnConnectionSelector() {
  const { data: connections, isLoading, isError } = useListVpnConnectionsQuery();
  const [activateVpnConnection, { isLoading: isActivating }] = useActivateVpnConnectionMutation();

  const active = connections?.find((connection) => connection.isActive);

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader title="VPN" />
      <Text color="secondary" variant="caption-2">
        Подключение, через которое worker обращается к AI-провайдерам — добавить и проверить
        можно на странице VPN.
      </Text>

      {isError && (
        <Alert theme="danger" view="filled" message="Не удалось получить список VPN-подключений" />
      )}

      <Select
        placeholder="VPN-подключение"
        value={active ? [String(active.id)] : []}
        onUpdate={([value]) => {
          if (value) void activateVpnConnection(Number(value));
        }}
        options={(connections ?? []).map((connection) => ({
          value: String(connection.id),
          content: connection.name,
        }))}
        loading={isLoading || isActivating}
        width="max"
      />
    </Card>
  );
}

const WORKER_SECRET_FIELDS: { name: WorkerSecretName; label: string; placeholder: string }[] = [
  { name: 'WORKER_CLAUDE_CODE_OAUTH_TOKEN', label: 'Claude Code OAuth Token', placeholder: 'sk-ant-oat...' },
  { name: 'WORKER_OPENAI_API_KEY', label: 'OpenAI API Key', placeholder: 'sk-proj-...' },
  { name: 'WORKER_DEEPSEEK_API_KEY', label: 'DeepSeek API Key', placeholder: 'sk-...' },
  { name: 'WORKER_QWEN_API_KEY', label: 'Qwen API Key', placeholder: 'sk-...' },
];

function WorkerSecretField({ name, label, placeholder }: { name: WorkerSecretName; label: string; placeholder: string }) {
  const [value, setValue] = useState('');
  const [setWorkerSecret, { isLoading }] = useSetWorkerSecretMutation();
  const [result, setResult] = useState<'success' | 'error' | null>(null);

  const handleSave = async () => {
    if (!value.trim()) return;
    setResult(null);

    try {
      await setWorkerSecret({ name, value: value.trim() }).unwrap();
      setValue('');
      setResult('success');
    } catch {
      setResult('error');
    }
  };

  return (
    <label className={styles.secretField}>
      <Text variant="body-2" color="secondary">
        {label}
      </Text>
      <div className={styles.secretRow}>
        <TextInput
          type="password"
          value={value}
          onUpdate={(next) => {
            setValue(next);
            setResult(null);
          }}
          placeholder={placeholder}
          hasClear
        />
        <Button view="normal" loading={isLoading} disabled={!value.trim()} onClick={() => void handleSave()}>
          Сохранить
        </Button>
      </div>
      {result === 'success' && (
        <Text color="positive" variant="caption-2">
          Сохранено — запущен передеплой worker (~15 минут).
        </Text>
      )}
      {result === 'error' && (
        <Text color="danger" variant="caption-2">
          Не удалось сохранить
        </Text>
      )}
    </label>
  );
}

// Collapsed by default: a write-blind, set-once-and-forget action (the
// comment below explains why) that would otherwise push the actually
// recurring task — "Новая задача" — further down the page every time it's
// opened. Same collapse-behind-a-toggle pattern as VpnPage's add-connection
// form.
function WorkerSecretsCard() {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader
        title="Ключи worker"
        actions={
          <Button view="flat" size="s" onClick={() => setIsExpanded((value) => !value)}>
            {isExpanded ? 'Скрыть' : 'Настроить'}
          </Button>
        }
      />

      {isExpanded && (
        <>
          <Text color="secondary" variant="caption-2">
            Ключи передаются один раз и не хранятся здесь для отображения — как и в GitHub
            Secrets, это запись «вслепую». Сохранение запускает передеплой worker (~15 минут).
          </Text>

          {WORKER_SECRET_FIELDS.map((field) => (
            <WorkerSecretField key={field.name} {...field} />
          ))}
        </>
      )}
    </Card>
  );
}

function ClaudeCredentialsCard() {
  const { data: credentials, isLoading } = useListClaudeCredentialsQuery();
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [createClaudeCredential, { isLoading: isCreating }] = useCreateClaudeCredentialMutation();
  const [deleteClaudeCredential] = useDeleteClaudeCredentialMutation();
  const [createError, setCreateErrorState] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const handleCreate = async () => {
    if (!name.trim() || !token.trim()) return;
    setCreateErrorState(null);

    try {
      await createClaudeCredential({ name: name.trim(), token: token.trim() }).unwrap();
      setName('');
      setToken('');
    } catch (err) {
      setCreateErrorState(typeof err === 'string' ? err : 'Не удалось сохранить токен');
    }
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      await deleteClaudeCredential(id).unwrap();
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader title="Claude-токены" />
      <Text color="secondary" variant="caption-2">
        Несколько именованных Claude Code OAuth токенов — хранятся в базе bridge, без GitHub
        Secrets и передеплоя. Первый в списке используется по умолчанию при запуске задачи на
        Sonnet/Opus.
      </Text>

      {isLoading && <Skeleton height={40} />}

      {credentials && credentials.length > 0 && (
        <ul className={styles.jobList}>
          {credentials.map((credential: ClaudeCredential) => (
            <li key={credential.id} className={styles.credentialRow}>
              <Text variant="body-2">{credential.name}</Text>
              <Button
                view="flat-danger"
                size="s"
                aria-label={`Удалить токен: ${credential.name}`}
                loading={deletingId === credential.id}
                onClick={() => void handleDelete(credential.id)}
              >
                <Icon data={TrashBin} size={16} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.secretRow}>
        <TextInput value={name} onUpdate={setName} placeholder="Название (например, личный)" />
        <TextInput
          type="password"
          value={token}
          onUpdate={setToken}
          placeholder="claude token"
          hasClear
        />
        <Button
          view="normal"
          loading={isCreating}
          disabled={!name.trim() || !token.trim()}
          onClick={() => void handleCreate()}
        >
          Добавить
        </Button>
      </div>

      {createError && <Alert theme="danger" view="filled" message={createError} />}
    </Card>
  );
}

interface JobDetailDialogProps {
  jobId: number;
  onClose: () => void;
}

function JobDetailDialog({ jobId, onClose }: JobDetailDialogProps) {
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

export function WorkerPage() {
  const { data: jobsData, isLoading: isLoadingJobs } = useListJobsQuery(undefined, {
    pollingInterval: JOB_POLL_INTERVAL_MS,
  });
  const { data: filesData, isLoading: isLoadingFiles } = useListFilesQuery();
  const { data: claudeCredentialsData } = useListClaudeCredentialsQuery();
  const [createJob, { isLoading: isCreating }] = useCreateJobMutation();
  const [peekFile] = usePeekFileMutation();
  const accessToken = useAppSelector((state) => state.auth.accessToken);

  const jobs = jobsData ?? [];
  const files = filesData ?? [];

  const [sourceFileId, setSourceFileId] = useState<number | undefined>(undefined);
  const [model, setModel] = useState<WorkerJobModel | undefined>(undefined);
  const [claudeCredentialId, setClaudeCredentialId] = useState<number | undefined>(undefined);
  const [decryptKey, setDecryptKey] = useState('');
  const { keys: parcelKeys } = useParcelKeys();
  const [createError, setCreateError] = useState<string | null>(null);
  const [openJobId, setOpenJobId] = useState<number | null>(null);
  // Separate from isCreating (the createJob mutation itself): this covers
  // the decrypt-and-re-upload round trip that has to finish first for an
  // encrypted source, which createJob's own loading state knows nothing about.
  const [isPreparingSource, setIsPreparingSource] = useState(false);

  const isClaudeModel = model === 'sonnet' || model === 'opus';

  // Defaults to the first (oldest-added) credential the moment the list
  // loads — only while nothing has been explicitly picked yet, so a
  // deliberate choice is never silently overwritten by a later refetch.
  useEffect(() => {
    if (claudeCredentialId === undefined && claudeCredentialsData && claudeCredentialsData.length > 0) {
      setClaudeCredentialId(claudeCredentialsData[0].id);
    }
  }, [claudeCredentialId, claudeCredentialsData]);

  const selectedFile = useMemo(
    () => filesData?.find((file: StoredFileMeta) => file.id === sourceFileId),
    [filesData, sourceFileId],
  );
  const needsDecryptKey = Boolean(selectedFile && isEncryptedFile(selectedFile.originalName));

  const handleCreate = async () => {
    if (!sourceFileId || !model || !selectedFile) return;
    if (needsDecryptKey && !decryptKey.trim()) return;

    setCreateError(null);

    try {
      // Worker only ever accepts unencrypted parcels (see
      // WorkerService.create on the backend) — an encrypted source gets
      // decrypted client-side first and re-uploaded as a plain Storage
      // file, which then becomes the job's actual source. The key itself
      // never leaves this tab.
      let actualSourceFileId = sourceFileId;

      if (needsDecryptKey) {
        setIsPreparingSource(true);
        const encrypted = await peekFile(sourceFileId).unwrap();
        const decrypted = await decryptParcel(encrypted, decryptKey.trim());
        const uploaded = await uploadWithProgress(
          decrypted,
          stripEncryptedSuffix(selectedFile.originalName),
          accessToken,
          () => {},
        );
        actualSourceFileId = uploaded.id;
        setIsPreparingSource(false);
      }

      const job = await createJob({
        sourceFileId: actualSourceFileId,
        model,
        ...(isClaudeModel && claudeCredentialId ? { claudeCredentialId } : {}),
      }).unwrap();
      setSourceFileId(undefined);
      setModel(undefined);
      setDecryptKey('');
      setOpenJobId(job.id);
    } catch (err) {
      setIsPreparingSource(false);
      // createJob's own rejection is a plain string (its transformErrorResponse);
      // decryptParcel/uploadWithProgress throw real Error instances.
      if (typeof err === 'string') {
        setCreateError(err);
      } else {
        setCreateError(err instanceof Error ? err.message : 'Не удалось создать задачу');
      }
    }
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title="Worker"
        description="Запуск ИИ-агента над посылкой из Storage — Claude, GPT, DeepSeek или Qwen."
      />

      <Card view="outlined" className={styles.card}>
        <SectionHeader title="Новая задача" />

        {files.length === 0 && !isLoadingFiles ? (
          <Text color="secondary">В Storage нет посылок — загрузите файл на странице Storage.</Text>
        ) : (
          <>
            <div className={styles.createForm}>
              <Select
                placeholder="Посылка"
                value={sourceFileId ? [String(sourceFileId)] : []}
                onUpdate={([value]) => {
                  setSourceFileId(value ? Number(value) : undefined);
                  setDecryptKey('');
                }}
                options={files.map((file: StoredFileMeta) => ({
                  value: String(file.id),
                  content: isEncryptedFile(file.originalName) ? `🔒 ${file.originalName}` : file.originalName,
                }))}
                width="max"
                loading={isLoadingFiles}
              />
              <Select
                placeholder="Модель"
                value={model ? [model] : []}
                onUpdate={([value]) => setModel(value as WorkerJobModel)}
                options={MODEL_OPTIONS}
                width="max"
              />
              {isClaudeModel && (
                <Select
                  placeholder="Claude-токен"
                  value={claudeCredentialId ? [String(claudeCredentialId)] : []}
                  onUpdate={([value]) => setClaudeCredentialId(value ? Number(value) : undefined)}
                  options={(claudeCredentialsData ?? []).map((credential: ClaudeCredential) => ({
                    value: String(credential.id),
                    content: credential.name,
                  }))}
                  width="max"
                />
              )}
              <Button
                view="action"
                onClick={() => void handleCreate()}
                loading={isCreating || isPreparingSource}
                disabled={!sourceFileId || !model || (needsDecryptKey && !decryptKey.trim())}
              >
                <Icon data={FaceRobot} size={16} />
                Запустить
              </Button>
            </div>

            {needsDecryptKey && (
              <label className={styles.decryptField}>
                <Text variant="body-2" color="secondary">
                  <Icon data={LockOpen} size={14} /> Эта посылка зашифрована — приватный ключ для расшифровки
                  (используется только в браузере, на сервер не отправляется)
                </Text>
                <ParcelKeyPicker keys={parcelKeys} onPick={setDecryptKey} />
                <TextArea value={decryptKey} onUpdate={setDecryptKey} rows={2} placeholder="-----BEGIN PRIVATE KEY-----" />
              </label>
            )}
          </>
        )}

        {createError && <Alert theme="danger" view="filled" message={createError} className={styles.createError} />}
      </Card>

      <Card view="outlined" className={styles.card}>
        <SectionHeader title="Задачи" meta={jobs.length > 0 ? String(jobs.length) : undefined} />

        {jobs.length === 0 && !isLoadingJobs ? (
          <EmptyState
            icon={FaceRobot}
            title="Задач ещё нет"
            description="Выберите посылку и модель выше, чтобы запустить первую."
          />
        ) : (
          <ul className={styles.jobList}>
            {jobs.map((job: WorkerJob) => (
              <li key={job.id}>
                <button type="button" className={styles.jobRow} onClick={() => setOpenJobId(job.id)}>
                  <div className={styles.jobRowMain}>
                    <Text variant="body-2">Задача #{job.id}</Text>
                    <Text color="secondary" variant="caption-2">
                      {MODEL_OPTIONS.find((m) => m.value === job.model)?.content ?? job.model}
                      {' · '}
                      {formatRelativeTime(job.createdAt)}
                    </Text>
                  </div>
                  <Label theme={STATUS_THEME[job.status]}>
                    {STATUS_LABEL[job.status]}
                    {isActive(job.status) ? '…' : ''}
                  </Label>
                  {job.status === 'succeeded' && <Icon data={ArrowDownToLine} size={16} />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <VpnConnectionSelector />

      <ClaudeCredentialsCard />

      <WorkerSecretsCard />

      {openJobId !== null && (
        <JobDetailDialog jobId={openJobId} onClose={() => setOpenJobId(null)} />
      )}
    </div>
  );
}
