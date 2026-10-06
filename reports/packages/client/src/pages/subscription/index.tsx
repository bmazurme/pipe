import { useState } from 'react';
import {
  Button, Dialog, DialogBody, DialogFooter, DialogHeader, Icon, Label, Select, Text, TextInput, useToaster,
} from '@gravity-ui/uikit';
import { ArrowsRotateLeft, Magnifier, Plus, TrashBin, Tray } from '@gravity-ui/icons';
import type { SubscriptionIssueType, SubscriptionStepType } from '@reports/shared';

import PageHeader from '../../components/page-header';
import { EmptyState, ErrorState, PageSkeleton } from '../../components/state';
import {
  useCreateManualSubscriptionIssueMutation,
  useGetSubscriptionConfigQuery,
  useGetSubscriptionIssuesQuery,
  useRemoveSubscriptionIssueMutation,
  useStartAnalysisMutation,
} from '../../store/api';
import { useDocumentTitle } from '../../hooks/use-document-title';
import { describeError } from '../../utils/describe-error';
import { isAnalysisIssue } from './analysis';
import BacklogPanel from './components/backlog-panel';
import IssueStepper from './components/issue-stepper';

import style from './subscription.module.css';

const emptyManualForm = { gitlabProjectId: '', title: '', description: '' };

const STEP_TITLES: Record<SubscriptionStepType, string> = {
  init: 'Ветка создана',
  pushed: 'Отправлено в bridge',
  pulled: 'Получено из bridge',
  published: 'Опубликовано',
};

function Subscription() {
  useDocumentTitle('Подписка');

  const toaster = useToaster();
  const { data, isLoading, error, refetch, isFetching } = useGetSubscriptionIssuesQuery();
  const { data: config } = useGetSubscriptionConfigQuery();
  const [createManual] = useCreateManualSubscriptionIssueMutation();
  const [removeIssue] = useRemoveSubscriptionIssueMutation();
  const [startAnalysis, { isLoading: isStartingAnalysis }] = useStartAnalysisMutation();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [isManualDialogOpen, setIsManualDialogOpen] = useState(false);
  const [manualForm, setManualForm] = useState(emptyManualForm);
  const [toRemove, setToRemove] = useState<SubscriptionIssueType | null>(null);

  const githubProjects = (config?.trackedProjects ?? []).filter((project) => project.provider === 'github');
  const issues = data ?? [];
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
  const handleStartAnalysis = async (projectId: string) => {
    try {
      await startAnalysis({ projectId }).unwrap();
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
                loading={isStartingAnalysis}
                onClick={() => handleStartAnalysis(githubProjects[0].gitlabProjectId)}
                title={`Анализ репозитория ${githubProjects[0].githubRepo}`}
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
        <div className={style.list}>
          {issues.map((issue) => (
            <div key={`${issue.projectId}-${issue.iid}`} className={style.row}>
              <button
                type="button"
                className={style.rowClickable}
                onClick={() => setOpenKey(`${issue.projectId}-${issue.iid}`)}
              >
                <div className={style.rowMain}>
                  <Text variant="body-2" className={style.rowTitle}>{issue.iid} {issue.title}</Text>
                  <div className={style.rowMeta}>
                    <Text variant="caption-2" color="secondary">{issue.projectName}</Text>
                    {issue.timeEstimate && (
                      <Text variant="caption-2" color="secondary">· {issue.timeEstimate}</Text>
                    )}
                  </div>
                </div>
                <div className={style.rowBadges}>
                  {issue.state === 'manual' && <Label theme="utility">Вручную</Label>}
                  {!issue.tracked && <Label theme="warning">Не отслеживается</Label>}
                  <Label theme={issue.subscription ? 'info' : 'normal'}>
                    {issue.subscription ? STEP_TITLES[issue.subscription.step] : 'Не начато'}
                  </Label>
                </div>
              </button>
              <Button
                view="flat"
                size="s"
                onClick={() => setToRemove(issue)}
                aria-label={`Удалить ${issue.iid}`}
                className={style.rowRemove}
              >
                <Icon data={TrashBin} size={16} />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!openIssue} onClose={() => setOpenKey(null)} size="m">
        <DialogHeader caption={openIssue ? `${openIssue.iid} ${openIssue.title}` : ''} />
        <DialogBody>
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
