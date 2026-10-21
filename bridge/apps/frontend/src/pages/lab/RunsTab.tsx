import { useEffect, useState } from 'react';
import { ArrowUpRightFromSquare, Plus, Rocket, Stop } from '@gravity-ui/icons';
import { Alert, Button, Icon, Label, Select, Skeleton, Text, TextArea } from '@gravity-ui/uikit';
import { Dialog } from '../../shared/ui/Dialog';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import {
  getErrorMessage,
  useCancelLabRunMutation,
  useListContextsQuery,
  useListLabProjectsQuery,
  useListLabRunsQuery,
  useRetryLabPublishMutation,
  useStartLabRunMutation,
} from '../../store/api';
import { EmptyState } from '../../widgets/EmptyState';
import { MODEL_OPTIONS } from '../worker/constants';
import styles from '../ImprovePage.module.css';
import { modelLabel, RUN_STATUS_LABEL, RUN_STATUS_THEME } from '../improve/improveLabels';

const FAST_POLL_MS = 5000;
const SLOW_POLL_MS = 30000;
const ACTIVE = ['preparing', 'queued', 'running', 'publishing'];

export function RunsTab() {
  const [pollingInterval, setPollingInterval] = useState(FAST_POLL_MS);
  const { data: runs, isLoading, isError } = useListLabRunsQuery(undefined, { pollingInterval, skipPollingIfUnfocused: true });
  const { data: projects } = useListLabProjectsQuery();
  const { data: contexts } = useListContextsQuery();
  const [start, { isLoading: isStarting }] = useStartLabRunMutation();
  const [cancel, { isLoading: isCancelling, originalArgs: cancellingId }] = useCancelLabRunMutation();
  const [retry, { isLoading: isRetrying }] = useRetryLabPublishMutation();
  const [form, setForm] = useState<{ projectId: string; task: string; model: string; contextId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasActive = Boolean(runs?.some((run) => ACTIVE.includes(run.status)));

  useEffect(() => {
    setPollingInterval(hasActive ? FAST_POLL_MS : SLOW_POLL_MS);
  }, [hasActive]);

  const handleStart = async () => {
    if (!form) return;
    if (!form.projectId) return setError('Выберите проект');
    if (form.task.trim().length < 3) return setError('Опишите задачу текстом');

    try {
      await start({ projectId: Number(form.projectId), task: form.task.trim(), model: form.model, contextId: form.contextId ? Number(form.contextId) : null }).unwrap();
      setForm(null);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось запустить'));
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <Button
          view="action"
          size="m"
          disabled={!projects?.some((project) => project.canWrite)}
          onClick={() => {
            setError(null);
            setForm({ projectId: String(projects?.find((project) => project.canWrite)?.id ?? ''), task: '', model: 'sonnet', contextId: '' });
          }}
        >
          <Icon data={Plus} size={16} />
          Новый запуск
        </Button>
      </div>

      {error && !form && <Alert theme="danger" view="filled" message={error} />}
      {isLoading && <Skeleton style={{ height: 120 }} />}
      {isError && <Alert theme="danger" view="filled" message="Не удалось загрузить запуски" />}
      {runs && runs.length === 0 && <EmptyState icon={Rocket} title="Запусков ещё не было" description="Запустите задачу вручную или дождитесь расписания." />}

      {runs?.map((run) => (
        <div key={run.id} className={styles.row}>
          <div className={styles.rowMain}>
            <Text variant="body-2" ellipsis title={run.task}>
              {run.title}
            </Text>
            <Text variant="caption-2" color="secondary">
              {run.repo} · {modelLabel(run.model)} · {run.trigger === 'schedule' ? 'по расписанию' : 'вручную'} · {formatRelativeTime(run.createdAt)}
              {run.note && ` · ${run.note}`}
            </Text>
            {run.error && (
              <Text variant="caption-2" color="danger" ellipsis title={run.error}>
                {run.error}
              </Text>
            )}
          </div>
          <div className={styles.rowActions}>
            <Label theme={RUN_STATUS_THEME[run.status]}>{RUN_STATUS_LABEL[run.status]}</Label>
            {run.prUrl && (
              <a href={run.prUrl} target="_blank" rel="noreferrer noopener" aria-label={`PR #${run.prNumber}`}>
                <Icon data={ArrowUpRightFromSquare} size={16} />
              </a>
            )}
            {run.status === 'failed' && run.jobId !== null && (
              <Button view="outlined" size="s" loading={isRetrying} onClick={() => void retry(run.id)}>
                Повторить публикацию
              </Button>
            )}
            {!ACTIVE.includes(run.status) && run.projectId !== null && projects?.some((project) => project.id === run.projectId && project.canWrite) && (
              <Button
                view="outlined"
                size="s"
                onClick={() => {
                  setError(null);
                  setForm({ projectId: String(run.projectId), task: run.task, model: run.model, contextId: '' });
                }}
              >
                Запустить снова
              </Button>
            )}
            {(run.status === 'queued' || run.status === 'running') && (
              <Button view="flat-danger" size="s" loading={isCancelling && cancellingId === run.id} aria-label={`Остановить запуск #${run.id}`} onClick={() => void cancel(run.id)}>
                <Icon data={Stop} size={16} />
              </Button>
            )}
          </div>
        </div>
      ))}

      <Dialog open={form !== null} onClose={() => setForm(null)} maxWidth="s" aria-labelledby="lab-run-title">
        <Dialog.Header caption="Новый запуск" id="lab-run-title" />
        <Dialog.Body>
          {form && (
            <div className={styles.form}>
              <Select
                label="Проект"
                value={[form.projectId]}
                onUpdate={([projectId]) => setForm({ ...form, projectId: projectId ?? '' })}
                options={(projects ?? []).filter((project) => project.canWrite).map((project) => ({ value: String(project.id), content: `${project.name} (${project.repo})` }))}
                width="max"
              />
              <Text variant="body-2">Задача</Text>
              <TextArea controlProps={{ 'aria-label': 'Задача' }} placeholder="Что сделать в репозитории — своими словами" minRows={4} maxRows={12} value={form.task} onUpdate={(task) => setForm({ ...form, task })} />
              <Select label="Модель" value={[form.model]} onUpdate={([model]) => setForm({ ...form, model })} options={MODEL_OPTIONS} width="max" />
              <Select
                label="Контекст"
                value={[form.contextId]}
                onUpdate={([contextId]) => setForm({ ...form, contextId: contextId ?? '' })}
                options={[{ value: '', content: 'Без контекста' }, ...(Array.isArray(contexts) ? contexts : []).map((context) => ({ value: String(context.id), content: context.name }))]}
                width="max"
              />
              {error && <Alert theme="danger" view="filled" message={error} />}
            </div>
          )}
        </Dialog.Body>
        <Dialog.Footer
          textButtonCancel="Отмена"
          textButtonApply="Запустить"
          propsButtonApply={{ loading: isStarting }}
          onClickButtonCancel={() => setForm(null)}
          onClickButtonApply={() => void handleStart()}
        />
      </Dialog>
    </div>
  );
}
