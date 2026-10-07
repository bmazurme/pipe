import { useEffect, useMemo, useState } from 'react';
import { FaceRobot, LockOpen } from '@gravity-ui/icons';
import { Alert, Button, Card, Icon, Select, Text, TextArea } from '@gravity-ui/uikit';

import {
  ClaudeCredential,
  StoredFileMeta,
  WorkerJobModel,
  useCreateJobMutation,
  useListClaudeCredentialsQuery,
  useListFilesQuery,
  usePeekFileMutation,
} from '../../store/api';
import { decryptParcel, isEncryptedFile, stripEncryptedSuffix } from '../../shared/lib/parcelCrypto';
import { useParcelKeys } from '../../shared/lib/parcelKeys';
import { useAppSelector } from '../../store/hooks';
import { ParcelKeyPicker } from '../../widgets/ParcelKeyPicker';
import { SectionHeader } from '../../widgets/SectionHeader';
import { uploadWithProgress } from '../storage/uploadWithProgress';
import styles from '../WorkerPage.module.css';
import { MODEL_OPTIONS } from './constants';

const LAST_MODEL_KEY = 'worker.lastModel';

// A per-viewer convenience only — storage can be blocked or throw, and the
// form must work identically without it.
function readLastModel(): WorkerJobModel | undefined {
  try {
    const value = localStorage.getItem(LAST_MODEL_KEY);

    return MODEL_OPTIONS.some((option) => option.value === value) ? (value as WorkerJobModel) : undefined;
  } catch {
    return undefined;
  }
}

function rememberModel(model: WorkerJobModel): void {
  try {
    localStorage.setItem(LAST_MODEL_KEY, model);
  } catch {
    // Not remembering the choice is fine.
  }
}

interface NewJobFormProps {
  onCreated: (jobId: number) => void;
}

export function NewJobForm({ onCreated }: NewJobFormProps) {
  const { data: filesData, isLoading: isLoadingFiles } = useListFilesQuery();
  const { data: claudeCredentialsData } = useListClaudeCredentialsQuery();
  const [createJob, { isLoading: isCreating }] = useCreateJobMutation();
  const [peekFile] = usePeekFileMutation();
  const accessToken = useAppSelector((state) => state.auth.accessToken);

  const files = filesData ?? [];

  const [sourceFileId, setSourceFileId] = useState<number | undefined>(undefined);
  const [model, setModel] = useState<WorkerJobModel | undefined>(readLastModel);
  const [claudeCredentialId, setClaudeCredentialId] = useState<number | undefined>(undefined);
  const [decryptKey, setDecryptKey] = useState('');
  const { keys: parcelKeys } = useParcelKeys();
  const [createError, setCreateError] = useState<string | null>(null);
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
      rememberModel(model);
      setSourceFileId(undefined);
      setDecryptKey('');
      onCreated(job.id);
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
  );
}
