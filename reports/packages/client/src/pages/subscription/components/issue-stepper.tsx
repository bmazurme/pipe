import { useState } from 'react';
import { Button, Icon, Select, Text, TextInput, useToaster } from '@gravity-ui/uikit';
import { Check, CodeFork, ArrowUpFromLine, ArrowDownToLine, PaperPlane } from '@gravity-ui/icons';
import type { SubscriptionIssueType, SubscriptionStepType } from '@reports/shared';

import {
  useGetSubscriptionConfigQuery,
  useGetSubscriptionIssueTimeQuery,
  useInitSubscriptionIssueMutation,
  usePushSubscriptionIssueMutation,
  usePullSubscriptionIssueMutation,
  usePublishSubscriptionIssueMutation,
} from '../../../store/api';
import { describeError } from '../../../utils/describe-error';

import style from '../subscription.module.css';

const STEP_ORDER: SubscriptionStepType[] = ['init', 'pushed', 'pulled', 'published'];
const STEP_LABELS = ['Init', 'Push', 'Pull', 'Publish'];

function IssueStepper({ issue }: { issue: SubscriptionIssueType }) {
  const toaster = useToaster();
  const [init, { isLoading: isIniting }] = useInitSubscriptionIssueMutation();
  const [push, { isLoading: isPushing }] = usePushSubscriptionIssueMutation();
  const [pull, { isLoading: isPulling }] = usePullSubscriptionIssueMutation();
  const [publish, { isLoading: isPublishing }] = usePublishSubscriptionIssueMutation();
  const { data: config } = useGetSubscriptionConfigQuery();

  const currentIndex = issue.subscription ? STEP_ORDER.indexOf(issue.subscription.step) : -1;
  const nextIndex = currentIndex + 1;
  const isPublishStep = nextIndex === 3;

  const { data: timeData } = useGetSubscriptionIssueTimeQuery(
    { projectId: issue.projectId, iid: issue.iid },
    { skip: !isPublishStep },
  );

  const [templateId, setTemplateId] = useState<string | undefined>(undefined);
  const [timeEstimate, setTimeEstimate] = useState('');

  const disabledReason = !issue.tracked
    ? 'Этот проект не отслеживается — добавьте локальный репозиторий в Settings'
    : undefined;

  const args = { projectId: issue.projectId, iid: issue.iid };

  const run = async (action: () => Promise<unknown>, successTitle: string, errorTitle: string) => {
    try {
      await action();
      toaster.add({ name: `subscription-${issue.iid}-ok`, theme: 'success', title: successTitle, autoHiding: 3000 });
    } catch (error) {
      toaster.add({
        name: `subscription-${issue.iid}-error`,
        theme: 'danger',
        title: errorTitle,
        content: describeError(error),
        isClosable: true,
      });
    }
  };

  const handleInit = () => run(() => init(args).unwrap(), 'Ветка создана', 'Не удалось создать ветку');
  const handlePush = () => run(() => push(args).unwrap(), 'Посылка отправлена в bridge', 'Не удалось отправить посылку');
  const handlePull = () => run(() => pull(args).unwrap(), 'Посылка получена из bridge', 'Не удалось получить посылку');
  const handlePublish = () => run(
    () => publish({ ...args, payload: { templateId, timeEstimate: timeEstimate || undefined } }).unwrap(),
    'Опубликовано в GitLab',
    'Не удалось опубликовать результат',
  );

  return (
    <div className={style.stepper}>
      <div className={style.steps}>
        {STEP_LABELS.map((label, i) => (
          <div className={style.step} key={label}>
            <div className={style.stepRow}>
              <span
                className={`${style.stepDot} ${i <= currentIndex ? style.stepDotDone : ''} ${i === nextIndex ? style.stepDotActive : ''}`}
              >
                {i <= currentIndex ? <Icon data={Check} size={14} /> : i + 1}
              </span>
              {i < STEP_LABELS.length - 1 && <span className={`${style.stepLine} ${i < currentIndex ? style.stepLineDone : ''}`} />}
            </div>
            <Text variant="caption-2" color="secondary" className={style.stepLabel}>{label}</Text>
          </div>
        ))}
      </div>

      {nextIndex === 0 && (
        <div className={style.stepAction}>
          <Text variant="body-2" color="secondary">
            Создаст ветку в локальном репозитории по маске имя-дата-номер задачи.
          </Text>
          <Button view="action" size="m" onClick={handleInit} loading={isIniting} disabled={!!disabledReason} title={disabledReason}>
            <Icon data={CodeFork} size={16} />
            Инициализировать
          </Button>
        </div>
      )}

      {nextIndex === 1 && (
        <div className={style.stepAction}>
          <Text variant="body-2" color="secondary">
            Упакует кодовую базу (с подстановкой словаря) и текст задачи в zip, отправит в bridge.
          </Text>
          <Button view="action" size="m" onClick={handlePush} loading={isPushing} disabled={!!disabledReason} title={disabledReason}>
            <Icon data={ArrowUpFromLine} size={16} />
            Отправить
          </Button>
        </div>
      )}

      {nextIndex === 2 && (
        <div className={style.stepAction}>
          <Text variant="body-2" color="secondary">
            Получит последнюю посылку из bridge и применит её поверх локального репозитория.
          </Text>
          <Button view="action" size="m" onClick={handlePull} loading={isPulling} disabled={!!disabledReason} title={disabledReason}>
            <Icon data={ArrowDownToLine} size={16} />
            Получить
          </Button>
        </div>
      )}

      {isPublishStep && (
        <div className={style.stepAction}>
          <div className={style.publishForm}>
            <Select
              placeholder="Шаблон комментария (необязательно)"
              value={templateId ? [templateId] : []}
              onUpdate={([value]) => setTemplateId(value)}
              options={(config?.commentTemplates ?? []).map((template) => ({ value: template.id, content: template.title }))}
              width="max"
              hasClear
            />
            <TextInput
              label="Оценка времени"
              placeholder="например, 3h"
              value={timeEstimate}
              onUpdate={setTimeEstimate}
              note={timeData?.humanTimeEstimate ? `Текущее значение: ${timeData.humanTimeEstimate}` : 'Текущая оценка не задана'}
            />
          </div>
          <Button view="action" size="m" onClick={handlePublish} loading={isPublishing} disabled={!!disabledReason} title={disabledReason}>
            <Icon data={PaperPlane} size={16} />
            Опубликовать
          </Button>
        </div>
      )}

      {nextIndex >= STEP_LABELS.length && (
        <Text variant="body-2" color="positive">Пайплайн по задаче завершён.</Text>
      )}

      {currentIndex >= 1 && (
        <div className={style.stepAction}>
          <Text variant="body-2" color="secondary">
            Внесли правки после ревью? Отправьте новую версию посылки — пайплайн вернётся на шаг pull.
          </Text>
          <Button view="outlined" size="m" onClick={handlePush} loading={isPushing} disabled={!!disabledReason} title={disabledReason}>
            <Icon data={ArrowUpFromLine} size={16} />
            Отправить повторно
          </Button>
        </div>
      )}
    </div>
  );
}

export default IssueStepper;
