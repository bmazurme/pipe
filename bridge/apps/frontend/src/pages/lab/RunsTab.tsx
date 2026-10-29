import { useEffect, useState } from 'react';
import { ArrowUpRightFromSquare, Plus, Rocket, Stop } from '@gravity-ui/icons';
import { Alert, Button, Icon, Label, Select, Skeleton, Text, TextArea, TextInput } from '@gravity-ui/uikit';
import { Dialog } from '../../shared/ui/Dialog';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import {
  getErrorMessage,
  type LabExecutor,
  type LabPrRefresh,
  type LabRunStatus,
  useCancelLabRunMutation,
  useListContextsQuery,
  useListLabProjectIssuesQuery,
  useListLabProjectsQuery,
  useListLabRunsQuery,
  useRefreshLabPrsMutation,
  useRetryLabPublishMutation,
  useStartLabRunMutation,
} from '../../store/api';
import { EmptyState } from '../../widgets/EmptyState';
import { MODEL_OPTIONS } from '../worker/constants';
import { JobDetailDialog } from '../worker/JobDetailDialog';
import { EXECUTOR_HINT, EXECUTOR_OPTIONS, executorLabel } from './executors';
import styles from '../ImprovePage.module.css';
import { modelLabel, RUN_STATUS_LABEL, RUN_STATUS_THEME } from '../improve/improveLabels';

const FAST_POLL_MS = 5000;
const SLOW_POLL_MS = 30000;
const ACTIVE = ['preparing', 'queued', 'running', 'publishing'];

// Improve's labels plus what only Lab learns about a pull request after it was opened.
const STATUS_LABEL: Record<LabRunStatus, string> = { ...RUN_STATUS_LABEL, pr_merged: 'PR влит', pr_closed: 'PR закрыт' };
const STATUS_THEME: Record<LabRunStatus, (typeof RUN_STATUS_THEME)[keyof typeof RUN_STATUS_THEME]> = { ...RUN_STATUS_THEME, pr_merged: 'success', pr_closed: 'normal' };

const describeRefresh = ({ checked, merged, closed, failed }: LabPrRefresh) =>
  `Проверено PR: ${checked} · влито: ${merged} · закрыто: ${closed}${failed ? ` · не удалось проверить: ${failed}` : ''}`;

export function RunsTab() {
  const [pollingInterval, setPollingInterval] = useState(FAST_POLL_MS);
  const [filterProjectId, setFilterProjectId] = useState('');
  const { data: runs, isLoading, isError } = useListLabRunsQuery(filterProjectId ? { projectId: Number(filterProjectId) } : undefined, { pollingInterval, skipPollingIfUnfocused: true });
  const { data: projects } = useListLabProjectsQuery();
  const { data: contexts } = useListContextsQuery();
  const [start, { isLoading: isStarting }] = useStartLabRunMutation();
  const [cancel, { isLoading: isCancelling, originalArgs: cancellingId, error: cancelError }] = useCancelLabRunMutation();
  const [confirmCancel, setConfirmCancel] = useState<{ id: number } | null>(null);
  const [retry, { isLoading: isRetrying }] = useRetryLabPublishMutation();
  const [refreshPrs, { isLoading: isRefreshing }] = useRefreshLabPrsMutation();
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [form, setForm] = useState<{ projectId: string; task: string; model: string; contextId: string; baseBranch: string; executor: LabExecutor; followUpOf?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const issuesProjectId = form && !form.followUpOf && form.projectId ? Number(form.projectId) : null;
  const { data: issues, error: issuesError } = useListLabProjectIssuesQuery(issuesProjectId ?? 0, { skip: issuesProjectId === null });
  const [openJobId, setOpenJobId] = useState<number | null>(null);
  const branchOf = (projectId: number | string | null) => projects?.find((project) => String(project.id) === String(projectId))?.baseBranch ?? '';
  const hasActive = Boolean(runs?.some((run) => ACTIVE.includes(run.status)));

  useEffect(() => {
    setPollingInterval(hasActive ? FAST_POLL_MS : SLOW_POLL_MS);
  }, [hasActive]);

  const handleStart = async () => {
    if (!form) return;
    if (!form.projectId) return setError('Выберите проект');
    if (form.task.trim().length < 3) return setError('Опишите задачу текстом');
    if (!form.baseBranch.trim()) return setError('Укажите ветку');

    try {
      await start({ projectId: Number(form.projectId), task: form.task.trim(), model: form.model, contextId: form.contextId ? Number(form.contextId) : null, baseBranch: form.baseBranch.trim(), executor: form.executor, ...(form.followUpOf ? { followUpOf: form.followUpOf } : {}) }).unwrap();
      setForm(null);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось запустить'));
    }
  };

  const handleRefreshPrs = async () => {
    setError(null);
    setRefreshNote(null);

    try {
      setRefreshNote(describeRefresh(await refreshPrs().unwrap()));
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось проверить PR'));
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
            const projectId = String(projects?.find((project) => project.canWrite)?.id ?? '');
            setForm({ projectId, task: '', model: 'sonnet', contextId: '', baseBranch: branchOf(projectId), executor: 'any' });
          }}
        >
          <Icon data={Plus} size={16} />
          Новый запуск
        </Button>
        <Select
          aria-label="Проект"
          value={[filterProjectId]}
          onUpdate={([projectId]) => setFilterProjectId(projectId ?? '')}
          options={[{ value: '', content: 'Все проекты' }, ...(projects ?? []).map((project) => ({ value: String(project.id), content: `${project.name} (${project.repo})` }))]}
        />
        <Button view="outlined" size="m" loading={isRefreshing} disabled={!runs?.some((run) => run.status === 'pr_open' && run.prNumber !== null && run.projectId !== null)} onClick={() => void handleRefreshPrs()}>
          Проверить PR
        </Button>
      </div>

      {refreshNote && <Alert theme="info" view="outlined" message={refreshNote} onClose={() => setRefreshNote(null)} />}
      {error && !form && <Alert theme="danger" view="filled" message={error} />}
      {cancelError && <Alert theme="danger" view="filled" message={getErrorMessage(cancelError, 'Не удалось остановить')} />}
      {isLoading && <Skeleton style={{ height: 120 }} />}
      {isError && <Alert theme="danger" view="filled" message="Не удалось загрузить запуски" />}
      {runs && runs.length === 0 && <EmptyState icon={Rocket} title={filterProjectId ? 'В этом проекте запусков ещё не было' : 'Запусков ещё не было'} description="Запустите задачу вручную или дождитесь расписания." />}

      {runs?.map((run) => (
        <div key={run.id} className={styles.row}>
          <div className={styles.rowMain}>
            <Text variant="body-2" ellipsis title={run.task}>
              {run.title}
            </Text>
            <Text variant="caption-2" color="secondary">
              {run.repo} · {modelLabel(run.model)}{executorLabel(run.executor) && ` · ${executorLabel(run.executor)}`} · {run.trigger === 'schedule' ? 'по расписанию' : 'вручную'} · {formatRelativeTime(run.createdAt)}
              {run.baseBranch && run.baseBranch !== branchOf(run.projectId) && ` · ветка ${run.baseBranch}`}
              {run.note && ` · ${run.note}`}
            </Text>
            {run.error && (
              <Text variant="caption-2" color="danger" ellipsis title={run.error}>
                {run.error}
              </Text>
            )}
          </div>
          <div className={styles.rowActions}>
            <Label theme={STATUS_THEME[run.status]}>{STATUS_LABEL[run.status]}</Label>
            {run.jobId !== null && (
              <Button size="xs" view="flat" onClick={() => setOpenJobId(run.jobId)}>
                Запуск #{run.jobId}
              </Button>
            )}
            {run.prUrl && (
              <a href={run.prUrl} target="_blank" rel="noreferrer noopener" aria-label={`PR #${run.prNumber}`}>
                <Icon data={ArrowUpRightFromSquare} size={16} />
              </a>
            )}
            {run.issueUrl && (
              <a href={run.issueUrl} target="_blank" rel="noreferrer noopener" aria-label={`Issue #${run.issueNumber}`}>
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
                  setForm({ projectId: String(run.projectId), task: run.task, model: run.model, contextId: '', baseBranch: run.baseBranch ?? branchOf(run.projectId), executor: run.executor ?? 'any' });
                }}
              >
                Запустить снова
              </Button>
            )}
            {run.status === 'pr_open' && run.branch && run.projectId !== null && projects?.some((project) => project.id === run.projectId && project.canWrite) && (
              <Button
                view="outlined"
                size="s"
                onClick={() => {
                  setError(null);
                  setForm({ projectId: String(run.projectId), task: '', model: run.model, contextId: '', baseBranch: run.branch ?? '', executor: run.executor ?? 'any', followUpOf: run.id });
                }}
              >
                Доработать
              </Button>
            )}
            {(run.status === 'queued' || run.status === 'running') && (
              <Button view="flat-danger" size="s" loading={isCancelling && cancellingId === run.id} aria-label={`Остановить запуск #${run.id}`} onClick={() => setConfirmCancel({ id: run.id })}>
                <Icon data={Stop} size={16} />
              </Button>
            )}
          </div>
        </div>
      ))}

      {openJobId !== null && <JobDetailDialog jobId={openJobId} onClose={() => setOpenJobId(null)} />}

      <Dialog open={confirmCancel !== null} onClose={() => setConfirmCancel(null)} maxWidth="s" aria-labelledby="lab-run-cancel-title">
        <Dialog.Header caption={`Остановить запуск #${confirmCancel?.id}?`} id="lab-run-cancel-title" />
        <Dialog.Body>
          <Text variant="body-2">Запуск будет остановлен, вернуть его нельзя.</Text>
        </Dialog.Body>
        <Dialog.Footer
          textButtonCancel="Не останавливать"
          textButtonApply="Остановить"
          propsButtonApply={{ view: 'outlined-danger' }}
          onClickButtonCancel={() => setConfirmCancel(null)}
          onClickButtonApply={() => {
            if (confirmCancel) void cancel(confirmCancel.id);
            setConfirmCancel(null);
          }}
        />
      </Dialog>

      <Dialog open={form !== null} onClose={() => setForm(null)} maxWidth="s" aria-labelledby="lab-run-title">
        <Dialog.Header caption={form?.followUpOf ? "Доработать PR" : "Новый запуск"} id="lab-run-title" />
        <Dialog.Body>
          {form && (
            <div className={styles.form}>
              <Select
                label="Проект"
                disabled={Boolean(form.followUpOf)}
                value={[form.projectId]}
                onUpdate={([projectId]) => setForm({ ...form, projectId: projectId ?? '', baseBranch: branchOf(projectId ?? '') })}
                options={(projects ?? []).filter((project) => project.canWrite).map((project) => ({ value: String(project.id), content: `${project.name} (${project.repo})` }))}
                width="max"
              />
              <TextInput label="Ветка" value={form.baseBranch} disabled={Boolean(form.followUpOf)} onUpdate={(baseBranch) => setForm({ ...form, baseBranch })} />
              {!form.followUpOf && (
                <>
                  <Select
                    label="Из issue"
                    placeholder="Не выбрано"
                    value={[]}
                    onUpdate={([number]) => {
                      const issue = issues?.find((item) => String(item.number) === number);

                      if (issue) setForm({ ...form, task: `#${issue.number} ${issue.title}\n\n${issue.body}\n\n${issue.htmlUrl}` });
                    }}
                    options={(issues ?? []).map((issue) => ({ value: String(issue.number), content: `#${issue.number} ${issue.title}` }))}
                    width="max"
                  />
                  {issuesError && <Alert theme="warning" view="outlined" message={typeof issuesError === 'string' ? issuesError : 'Не удалось загрузить issues'} />}
                </>
              )}
              <Text variant="body-2">Задача</Text>
              <TextArea controlProps={{ 'aria-label': 'Задача' }} placeholder="Что сделать в репозитории — своими словами" minRows={4} maxRows={12} value={form.task} onUpdate={(task) => setForm({ ...form, task })} />
              <Select label="Модель" value={[form.model]} onUpdate={([model]) => setForm({ ...form, model })} options={MODEL_OPTIONS} width="max" />
              <Select label="Где выполнять" value={[form.executor]} onUpdate={([executor]) => setForm({ ...form, executor: (executor as LabExecutor) ?? 'any' })} options={EXECUTOR_OPTIONS} width="max" />
              {form.executor === 'fusion' && (
                <Text variant="caption-2" color="secondary">
                  {EXECUTOR_HINT}
                </Text>
              )}
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
