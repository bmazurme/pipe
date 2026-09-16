import { useState } from 'react';
import { Button, Dialog, DialogBody, DialogHeader, Icon, Label, Text } from '@gravity-ui/uikit';
import { ArrowsRotateLeft, Tray } from '@gravity-ui/icons';
import type { SubscriptionStepType } from '@reports/shared';

import PageHeader from '../../components/page-header';
import { EmptyState, ErrorState, PageSkeleton } from '../../components/state';
import { useGetSubscriptionIssuesQuery } from '../../store/api';
import { useDocumentTitle } from '../../hooks/use-document-title';
import { describeError } from '../../utils/describe-error';
import IssueStepper from './components/issue-stepper';

import style from './subscription.module.css';

const STEP_TITLES: Record<SubscriptionStepType, string> = {
  init: 'Ветка создана',
  pushed: 'Отправлено в bridge',
  pulled: 'Получено из bridge',
  published: 'Опубликовано',
};

function Subscription() {
  useDocumentTitle('Подписка');

  const { data, isLoading, error, refetch, isFetching } = useGetSubscriptionIssuesQuery();
  const [openKey, setOpenKey] = useState<string | null>(null);

  const issues = data ?? [];
  const openIssue = issues.find((issue) => `${issue.projectId}-${issue.iid}` === openKey) ?? null;

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
          <Button view="outlined" size="m" onClick={refetch} loading={isFetching}>
            <Icon data={ArrowsRotateLeft} size={16} />
            Обновить
          </Button>
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
            <button
              type="button"
              key={`${issue.projectId}-${issue.iid}`}
              className={style.row}
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
                {!issue.tracked && <Label theme="warning">Не отслеживается</Label>}
                <Label theme={issue.subscription ? 'info' : 'normal'}>
                  {issue.subscription ? STEP_TITLES[issue.subscription.step] : 'Не начато'}
                </Label>
              </div>
            </button>
          ))}
        </div>
      )}

      <Dialog open={!!openIssue} onClose={() => setOpenKey(null)} size="m">
        <DialogHeader caption={openIssue ? `${openIssue.iid} ${openIssue.title}` : ''} />
        <DialogBody>
          {openIssue && <IssueStepper issue={openIssue} />}
        </DialogBody>
      </Dialog>
    </div>
  )
}

export default Subscription;
