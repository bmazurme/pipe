import { useState } from 'react';
import { ArrowRotateRight, ArrowsRotateLeft, Clock } from '@gravity-ui/icons';
import { Alert, Button, Icon, Select } from '@gravity-ui/uikit';
import { Dialog } from '../../shared/ui/Dialog';

import {
  getErrorMessage,
  useListClaudeCredentialsQuery,
  useListContextsQuery,
  useListProviderCredentialsQuery,
  useRetryJobMutation,
  WorkerJob,
  WorkerJobModel,
} from '../../store/api';
import { limitResetAt } from './claudeLimits';
import { MODEL_OPTIONS } from './constants';

const SAME = '';
const NO_CONTEXT = 'none';
const PROVIDER_MODELS: WorkerJobModel[] = ['gpt', 'deepseek', 'qwen', 'custom'];

interface RetryJobButtonProps {
  job: WorkerJob;
  /** Icon-only, for a row in the list. */
  compact?: boolean;
}

// "Retry" for a job that failed or was stopped: queues a NEW job over the same
// parcel, model and credential (the failed one stays as history). Only the
// failure case needs a dialog — a retry itself is cheap and undoable (stop it).
export function RetryJobButton({ job, compact = false }: RetryJobButtonProps) {
  const [retryJob, { isLoading }] = useRetryJobMutation();
  const [error, setError] = useState<string | null>(null);
  const [otherOpen, setOtherOpen] = useState(false);
  const [newModel, setNewModel] = useState<WorkerJobModel>(job.model);
  const [newCredential, setNewCredential] = useState(SAME);
  const [newContext, setNewContext] = useState<string | null>(null);
  const failedOnLimit = job.status === 'failed' && /session limit/i.test(job.errorMessage ?? '');
  // Only asked for when it matters: the snapshot of the token the job ran on.
  const { data: credentials } = useListClaudeCredentialsQuery(undefined, { skip: !failedOnLimit && !otherOpen });
  const { data: providerCredentials } = useListProviderCredentialsQuery(undefined, { skip: !otherOpen });

  const { data: contexts } = useListContextsQuery(undefined, { skip: !otherOpen });

  if (job.status !== 'failed' && job.status !== 'cancelled') return null;

  const credential = credentials?.find((item) => item.id === job.claudeCredentialId || item.name === job.usedClaudeCredentialName);
  const resetAt = limitResetAt(job.errorMessage, credential?.limits, Date.now());

  const isProvider = PROVIDER_MODELS.includes(newModel);
  // A custom model has no default key: unless the job already ran on one, the owner picks (the first is preselected).
  const needsOwnKey = newModel === 'custom' && job.model !== 'custom';
  const tokenOptions = [
    ...(needsOwnKey ? [] : [{ value: SAME, content: 'как в задаче' }]),
    ...(isProvider
      ? (providerCredentials ?? []).filter((item) => item.provider === newModel)
      : (credentials ?? [])
    ).map((item) => ({ value: String(item.id), content: item.name })),
  ];

  const firstCustomKey = needsOwnKey ? (providerCredentials ?? []).find((item) => item.provider === 'custom') : undefined;
  const shownCredential = newCredential === SAME && firstCustomKey ? String(firstCustomKey.id) : newCredential;

  // Untouched = the answers saved from the Questions page for this task, when there are any, else the job's own.
  const answersContext = contexts?.find((item) => item.name === `Ответы: ${job.taskKey}`);
  const contextValue = newContext ?? (answersContext ? String(answersContext.id) : SAME);
  const contextOptions = [
    { value: SAME, content: 'контекст задачи' },
    { value: NO_CONTEXT, content: 'без контекста' },
    ...(contexts ?? []).map((item) => ({ value: String(item.id), content: item.name })),
  ];

  const handleModelChange = (value: WorkerJobModel) => {
    setNewModel(value);
    setNewCredential(SAME);
  };

  const handleRetryOther = async () => {
    const credentialId = newCredential === SAME ? firstCustomKey?.id : Number(newCredential);
    setOtherOpen(false);
    await handleRetry(undefined, {
      model: newModel,
      ...(contextValue === NO_CONTEXT ? { withoutContext: true } : contextValue !== SAME ? { contextId: Number(contextValue) } : {}),
      ...(credentialId !== undefined ? (isProvider ? { providerCredentialId: credentialId } : { claudeCredentialId: credentialId }) : {}),
    });
  };

  const handleRetry = async (
    notBefore?: string,
    overrides?: { model?: WorkerJobModel; claudeCredentialId?: number; providerCredentialId?: number; contextId?: number; withoutContext?: boolean },
  ) => {
    setError(null);

    try {
      await retryJob({ id: job.id, notBefore, ...overrides }).unwrap();
    } catch (err) {
      // transformErrorResponse has already reduced the error to bridge's message.
      setError(typeof err === 'string' && err ? err : getErrorMessage(err, 'Не удалось перезапустить задачу'));
    }
  };

  return (
    <>
      <Button
        view={compact ? 'flat-secondary' : 'outlined'}
        size={compact ? 's' : 'm'}
        loading={isLoading}
        aria-label={compact ? `Перезапустить: задача #${job.id}` : undefined}
        title={compact ? 'Перезапустить' : undefined}
        onClick={() => void handleRetry()}
      >
        <Icon data={ArrowRotateRight} size={16} />
        {!compact && 'Перезапустить'}
      </Button>

      {resetAt && (
        <Button
          view={compact ? 'flat-secondary' : 'outlined'}
          size={compact ? 's' : 'm'}
          loading={isLoading}
          aria-label={`Перезапустить после сброса лимита: задача #${job.id}`}
          title={`Перезапустить после сброса лимита (${new Date(resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`}
          onClick={() => void handleRetry(resetAt)}
        >
          <Icon data={Clock} size={16} />
          {!compact && 'Перезапустить после сброса лимита'}
        </Button>
      )}

      {!compact && (
        <Button view="outlined" size="m" loading={isLoading} onClick={() => setOtherOpen(true)}>
          <Icon data={ArrowsRotateLeft} size={16} />
          Перезапустить с другой моделью…
        </Button>
      )}

      <Dialog open={otherOpen} onClose={() => setOtherOpen(false)} maxWidth="s" aria-labelledby={`retry-other-${job.id}`}>
        <Dialog.Header caption="Перезапустить с другой моделью" id={`retry-other-${job.id}`} />
        <Dialog.Body>
          <Select
            label="Модель"
            width="max"
            value={[newModel]}
            options={MODEL_OPTIONS}
            onUpdate={(value) => handleModelChange(value[0] as WorkerJobModel)}
          />
          <Select
            label="Токен"
            width="max"
            value={[shownCredential]}
            options={tokenOptions}
            onUpdate={(value) => setNewCredential(value[0] ?? SAME)}
          />
          <Select
            label="Context"
            width="max"
            value={[contextValue]}
            options={contextOptions}
            onUpdate={(value) => setNewContext(value[0] ?? SAME)}
          />
        </Dialog.Body>
        <Dialog.Footer
          textButtonCancel="Отмена"
          onClickButtonCancel={() => setOtherOpen(false)}
          textButtonApply="Перезапустить"
          onClickButtonApply={() => void handleRetryOther()}
        />
      </Dialog>

      <Dialog open={error !== null} onClose={() => setError(null)} maxWidth="s" aria-labelledby={`retry-job-${job.id}`}>
        <Dialog.Header caption={`Не удалось перезапустить задачу #${job.id}`} id={`retry-job-${job.id}`} />
        <Dialog.Body>{error && <Alert theme="danger" view="filled" message={error} />}</Dialog.Body>
        <Dialog.Footer textButtonApply="Закрыть" onClickButtonApply={() => setError(null)} />
      </Dialog>
    </>
  );
}
