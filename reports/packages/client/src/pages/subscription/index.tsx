import { useState } from 'react';
import {
  Alert, Button, Dialog, DialogBody, DialogFooter, DialogHeader, Icon, Label, SegmentedRadioGroup, Select, Text, TextInput, useToaster,
} from '@gravity-ui/uikit';
import { ArrowsRotateLeft, ArrowUpRightFromSquare, Magnifier, Plus, TrashBin, Tray } from '@gravity-ui/icons';
import type { AnalysisKindType, SubscriptionIssueType, WorkerModelType } from '@reports/shared';

import PageHeader from '../../components/page-header';
import { EmptyState, ErrorState, PageSkeleton } from '../../components/state';
import {
  useCreateManualSubscriptionIssueMutation,
  useGetServerCodeStatusQuery,
  useGetSubscriptionConfigQuery,
  useGetSubscriptionIssuesQuery,
  useRemoveSubscriptionIssueMutation,
  useSetAutoStartWorkerModelMutation,
  useStartAnalysisMutation,
} from '../../store/api';
import { useDocumentTitle } from '../../hooks/use-document-title';
import { describeError } from '../../utils/describe-error';
import { isAnalysisIssue } from './analysis';
import {
  STEP_BADGE_THEME, STEP_TITLES, countByGroup, filterIssues, groupByProject, type StatusFilter,
} from './status';
import AnalysisDialog from './components/analysis-dialog';
import BacklogPanel from './components/backlog-panel';
import IssueStepper from './components/issue-stepper';

import style from './subscription.module.css';

const AUTO_START_OPTIONS: { value: WorkerModelType | 'off'; content: string }[] = [
  { value: 'off', content: 'Вручную' },
  { value: 'sonnet', content: 'Claude Sonnet' },
  { value: 'opus', content: 'Claude Opus' },
  { value: 'gpt', content: 'GPT' },
  { value: 'deepseek', content: 'DeepSeek' },
  { value: 'qwen', content: 'Qwen' },
];

const emptyManualForm = { gitlabProjectId: '', title: '', description: '' };

function Subscription() {
  useDocumentTitle('Подписка');

  const toaster = useToaster();
  const { data, isLoading, error, refetch, isFetching } = useGetSubscriptionIssuesQuery();
  const { data: config } = useGetSubscriptionConfigQuery();
  const { data: codeStatus } = useGetServerCodeStatusQuery(undefined, { pollingInterval: 60_000 });
  const [setAutoStart] = useSetAutoStartWorkerModelMutation();
  const [createManual] = useCreateManualSubscriptionIssueMutation();
  const [removeIssue] = useRemoveSubscriptionIssueMutation();
  const [startAnalysis, { isLoading: isStartingAnalysis }] = useStartAnalysisMutation();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [isManualDialogOpen, setIsManualDialogOpen] = useState(false);
  const [manualForm, setManualForm] = useState(emptyManualForm);
  const [toRemove, setToRemove] = useState<SubscriptionIssueType | null>(null);
  const [isAnalysisDialogOpen, setIsAnalysisDialogOpen] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');

  const githubProjects = (config?.trackedProjects ?? []).filter((project) => project.provider === 'github');
  const issues = data ?? [];
  const counts = countByGroup(issues);
  const visibleIssues = filterIssues(issues, filter, query);
  const groups = groupByProject(visibleIssues);
  const openIssue = issues.find((issue) => `${issue.projectId}-${issue.iid}` === openKey) ?? null;

  const handleCreateManual = async () => {
    if (!manualForm.gitlabProjectId || !manualForm.title) {
      return;
    }

    setIsManualDialogOpen(false);
    setManualForm(emptyManualForm);

    try {
      await createManual(manualForm).unwrap();
    } catch (error) {
      toaster.add({
        name: 'subscription-manual-create-error',
        theme: 'danger',
        title: 'Не удалось создать посылку',
        content: describeError(error),
        isClosable: true,
      });
    }
  };

  // Creates an ordinary task whose description is the analysis prompt; the
  // usual Init → Push → worker → Pull pipeline then carries it.
  const handleStartAnalysis = async (payload: { projectId: string; kind: AnalysisKindType; module?: string }) => {
    try {
      await startAnalysis(payload).unwrap();
      setIsAnalysisDialogOpen(false);
      toaster.add({ name: 'analysis-started', theme: 'success', title: 'Задача анализа создана — отправьте её (Push)', autoHiding: 5000 });
    } catch (analysisError) {
      toaster.add({
        name: 'analysis-start-error',
        theme: 'danger',
        title: 'Не удалось запустить анализ',
        content: describeError(analysisError),
        isClosable: true,
      });
    }
  };

  const handleAutoStartChange = async (value: WorkerModelType | 'off') => {
    try {
      await setAutoStart({ model: value === 'off' ? null : value }).unwrap();
    } catch (autoStartError) {
      toaster.add({
        name: 'auto-start-error',
        theme: 'danger',
        title: 'Не удалось сохранить настройку',
        content: describeError(autoStartError),
        isClosable: true,
      });
    }
  };

  const handleRemove = async () => {
    const issue = toRemove;

    setToRemove(null);

    if (!issue) {
      return;
    }

    try {
      await removeIssue({ projectId: issue.projectId, iid: issue.iid }).unwrap();
    } catch (error) {
      toaster.add({
        name: 'subscription-remove-error',
        theme: 'danger',
        title: 'Не удалось удалить запись',
        content: describeError(error),
        isClosable: true,
      });
    }
  };

  if (isLoading) {
    return <PageSkeleton />;
  }

  if (error) {
    return (
      <ErrorState
        message={describeError(error, 'Не удалось загрузить список задач')}
        onRetry={refetch}
      />
    );
  }

  return (
    <div className={style.wrapper}>
      <PageHeader
        title="Подписка"
        description="Открытые задачи GitLab и пайплайн init → push → pull → publish"
        actions={(
          <>
            {githubProjects.length > 0 && (
              <Button
                view="outlined"
                size="m"
                onClick={() => setIsAnalysisDialogOpen(true)}
                title="Выбрать тип анализа и модуль"
              >
                <Icon data={Magnifier} size={16} />
                Запустить анализ
              </Button>
            )}
            <Button view="outlined" size="m" onClick={() => setIsManualDialogOpen(true)}>
              <Icon data={Plus} size={16} />
              Добавить вручную
            </Button>
            <Button view="outlined" size="m" onClick={refetch} loading={isFetching}>
              <Icon data={ArrowsRotateLeft} size={16} />
              Обновить
            </Button>
          </>
        )}
      />

      {codeStatus?.stale && (
        <Alert
          className={style.staleBanner}
          theme="warning"
          view="filled"
          title="Сервер reports работает на устаревшем коде"
          message="Файлы изменились после его запуска (например, после pull ветки). Автопилот и отправка посылок могут вести себя по-старому — перезапустите сервер."
        />
      )}

      {issues.length === 0 ? (
        <EmptyState
          icon={<Icon data={Tray} size={28} />}
          title="Открытых задач нет"
          description="Проверьте настройки GitLab или обновите список."
          action={(
            <Button view="outlined" size="m" onClick={refetch} loading={isFetching}>
              <Icon data={ArrowsRotateLeft} size={16} />
              Обновить
            </Button>
          )}
        />
      ) : (
        <>
          <div className={style.toolbar}>
            <SegmentedRadioGroup
              size="m"
              value={filter}
              onUpdate={(value) => setFilter(value as StatusFilter)}
              aria-label="Фильтр по статусу"
            >
              <SegmentedRadioGroup.Option value="all">Все · {counts.all}</SegmentedRadioGroup.Option>
              <SegmentedRadioGroup.Option value="new">Не начато · {counts.new}</SegmentedRadioGroup.Option>
              <SegmentedRadioGroup.Option value="active">В работе · {counts.active}</SegmentedRadioGroup.Option>
              <SegmentedRadioGroup.Option value="done">Готово · {counts.done}</SegmentedRadioGroup.Option>
            </SegmentedRadioGroup>
            <Select
              size="m"
              label="Worker:"
              value={[config?.autoStartWorkerModel ?? 'off']}
              onUpdate={([value]) => void handleAutoStartChange(value as WorkerModelType | 'off')}
              options={AUTO_START_OPTIONS}
              title="Какую модель запускать на worker сразу после отправки посылки"
            />
            <TextInput
              className={style.search}
              size="m"
              placeholder="Поиск по номеру, названию, репозиторию"
              value={query}
              onUpdate={setQuery}
              hasClear
              controlProps={{ 'aria-label': 'Поиск задач' }}
            />
          </div>

          {visibleIssues.length === 0 ? (
            <EmptyState
              icon={<Icon data={Magnifier} size={28} />}
              title="Ничего не найдено"
              description="Измените запрос или выберите другой статус."
              action={(
                <Button view="outlined" size="m" onClick={() => { setFilter('all'); setQuery(''); }}>
                  Сбросить фильтры
                </Button>
              )}
            />
          ) : (
            <div className={style.groups}>
              {groups.map((group) => (
                <section key={group.projectName} className={style.group}>
                  {groups.length > 1 && (
                    <div className={style.groupHeader}>
                      <Text variant="subheader-2">{group.projectName}</Text>
                      <Label size="s" theme="normal">{group.issues.length}</Label>
                    </div>
                  )}
                  <div className={style.list}>
                    {group.issues.map((issue) => (
                      <div key={`${issue.projectId}-${issue.iid}`} className={style.row}>
                        <button
                          type="button"
                          className={style.rowClickable}
                          onClick={() => setOpenKey(`${issue.projectId}-${issue.iid}`)}
                        >
                          <span className={style.rowIid}>#{issue.iid}</span>
                          <div className={style.rowMain}>
                            <Text variant="body-2" className={style.rowTitle} title={issue.title}>{issue.title}</Text>
                            <div className={style.rowMeta}>
                              {groups.length === 1 && (
                                <Text variant="caption-2" color="secondary">{issue.projectName}</Text>
                              )}
                              {issue.timeEstimate && (
                                <Text variant="caption-2" color="secondary">{groups.length === 1 ? '· ' : ''}{issue.timeEstimate}</Text>
                              )}
                            </div>
                          </div>
                          <div className={style.rowBadges}>
                            {issue.state === 'manual' && <Label theme="utility">Вручную</Label>}
                            {!issue.tracked && <Label theme="warning">Не отслеживается</Label>}
                            <Label theme={issue.subscription ? STEP_BADGE_THEME[issue.subscription.step] : 'normal'}>
                              {issue.subscription ? STEP_TITLES[issue.subscription.step] : 'Не начато'}
                            </Label>
                          </div>
                        </button>
                        <Button
                          view="flat-secondary"
                          size="s"
                          onClick={() => setToRemove(issue)}
                          aria-label={`Удалить ${issue.iid}`}
                          title="Удалить запись"
                          className={style.rowRemove}
                        >
                          <Icon data={TrashBin} size={16} />
                        </Button>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      <AnalysisDialog
        open={isAnalysisDialogOpen}
        projects={githubProjects}
        loading={isStartingAnalysis}
        onClose={() => setIsAnalysisDialogOpen(false)}
        onStart={handleStartAnalysis}
      />

      <Dialog open={!!openIssue} onClose={() => setOpenKey(null)} size="m">
        <DialogHeader caption={openIssue ? `#${openIssue.iid} ${openIssue.title}` : ''} />
        <DialogBody>
          {openIssue && (
            <div className={style.issueMeta}>
              <Text variant="body-2" color="secondary">{openIssue.projectName}</Text>
              {openIssue.webUrl && (
                <a className={style.issueLink} href={openIssue.webUrl} target="_blank" rel="noreferrer noopener">
                  Открыть задачу
                  <Icon data={ArrowUpRightFromSquare} size={14} />
                </a>
              )}
            </div>
          )}
          {openIssue?.description && (
            <details className={style.issueDescription}>
              <summary>Описание задачи</summary>
              <pre>{openIssue.description}</pre>
            </details>
          )}
          {openIssue && <IssueStepper issue={openIssue} />}
          {openIssue && isAnalysisIssue(openIssue) && <BacklogPanel issue={openIssue} />}
        </DialogBody>
      </Dialog>

      <Dialog open={isManualDialogOpen} onClose={() => setIsManualDialogOpen(false)}>
        <DialogHeader caption="Создать посылку вручную" />
        <DialogBody>
          <div className={style.publishForm}>
            <Select
              placeholder="Отслеживаемый репозиторий"
              value={manualForm.gitlabProjectId ? [manualForm.gitlabProjectId] : []}
              onUpdate={([gitlabProjectId]) => setManualForm((prev) => ({ ...prev, gitlabProjectId }))}
              options={(config?.trackedProjects ?? []).map((project) => ({ value: project.gitlabProjectId, content: project.gitlabProjectId }))}
              width="max"
            />
            <TextInput
              label="Заголовок"
              value={manualForm.title}
              onUpdate={(title) => setManualForm((prev) => ({ ...prev, title }))}
            />
            <textarea
              className={style.templateBody}
              placeholder="Описание"
              value={manualForm.description}
              onChange={(event) => setManualForm((prev) => ({ ...prev, description: event.target.value }))}
            />
          </div>
        </DialogBody>
        <DialogFooter
          onClickButtonCancel={() => setIsManualDialogOpen(false)}
          onClickButtonApply={handleCreateManual}
          textButtonApply="Создать"
          textButtonCancel="Отмена"
          propsButtonApply={{ disabled: !manualForm.gitlabProjectId || !manualForm.title }}
        />
      </Dialog>

      <Dialog open={!!toRemove} onClose={() => setToRemove(null)}>
        <DialogHeader caption="Удалить запись" />
        <DialogBody>
          {toRemove?.state === 'manual'
            ? `Посылка «${toRemove?.title}» будет удалена без возможности восстановления.`
            : `Локальный прогресс по задаче ${toRemove?.iid} будет сброшен — сама задача останется в GitLab.`}
        </DialogBody>
        <DialogFooter
          onClickButtonCancel={() => setToRemove(null)}
          onClickButtonApply={handleRemove}
          textButtonApply="Удалить"
          textButtonCancel="Отмена"
          propsButtonApply={{ view: 'outlined-danger' }}
        />
      </Dialog>
    </div>
  )
}

export default Subscription;
