import { useState } from 'react';
import { Alert, Button, Checkbox, Label, Text, useToaster } from '@gravity-ui/uikit';
import type { BacklogRiskType, SubscriptionIssueType } from '@reports/shared';

import { useCreateBacklogIssuesMutation, useGetBacklogQuery } from '../../../store/api';
import { describeError } from '../../../utils/describe-error';

import style from '../subscription.module.css';

const RISK_THEME: Record<BacklogRiskType, 'success' | 'warning' | 'danger'> = {
  low: 'success',
  medium: 'warning',
  high: 'danger',
};

// The human gate of the loop: the analyzer only *proposes*; nothing becomes a
// GitHub issue until the user ticks it here.
function BacklogPanel({ issue }: { issue: SubscriptionIssueType }) {
  const toaster = useToaster();
  const step = issue.subscription?.step;
  const ready = step === 'pulled' || step === 'published';
  const { data, error, isFetching } = useGetBacklogQuery({ projectId: issue.projectId, iid: issue.iid }, { skip: !ready });
  const [createIssues, { isLoading: isCreating }] = useCreateBacklogIssuesMutation();
  const [selected, setSelected] = useState<number[]>([]);

  if (!ready) {
    return (
      <Text variant="body-2" color="secondary">
        Бэклог появится после шага Pull — когда worker вернёт результат анализа.
      </Text>
    );
  }

  const toggle = (index: number) => setSelected((prev) => (prev.includes(index) ? prev.filter((item) => item !== index) : [...prev, index]));

  const handleCreate = async () => {
    try {
      const result = await createIssues({ projectId: issue.projectId, iid: issue.iid, payload: { indices: selected } }).unwrap();

      setSelected([]);
      toaster.add({
        name: `backlog-${issue.iid}-ok`,
        theme: result.created.length ? 'success' : 'warning',
        title: result.created.length
          ? `Создано задач: ${result.created.length} (${result.created.map((item) => `#${item.number}`).join(', ')})`
          : 'Ничего не создано',
        content: result.skipped.length ? result.skipped.map((item) => `${item.title}: ${item.reason}`).join('; ') : undefined,
        autoHiding: 6000,
      });
    } catch (createError) {
      toaster.add({
        name: `backlog-${issue.iid}-error`,
        theme: 'danger',
        title: 'Не удалось создать задачи',
        content: describeError(createError),
        isClosable: true,
      });
    }
  };

  if (error) {
    return <Alert theme="danger" title="Бэклог недоступен" message={describeError(error, 'Не удалось загрузить бэклог')} />;
  }

  if (isFetching && !data) {
    return <Text variant="body-2" color="secondary">Читаю бэклог из ветки…</Text>;
  }

  const items = data?.items ?? [];

  if (items.length === 0) {
    return <Text variant="body-2" color="secondary">Анализ не нашёл, что предложить.</Text>;
  }

  return (
    <div className={style.backlog}>
      <Text variant="subheader-2">Предложения анализа ({items.length})</Text>
      {items.map((item, index) => (
        <div key={item.title} className={style.backlogItem}>
          <Checkbox
            checked={selected.includes(index)}
            disabled={item.duplicateOf !== undefined}
            onUpdate={() => toggle(index)}
            content={item.title}
          />
          <div className={style.rowBadges}>
            <Label theme={RISK_THEME[item.risk]}>{item.risk}</Label>
            {item.duplicateOf !== undefined && <Label theme="unknown">дубликат #{item.duplicateOf}</Label>}
          </div>
          <details className={style.backlogBody}>
            <summary>Описание</summary>
            <pre>{item.body}</pre>
          </details>
        </div>
      ))}
      <Button view="action" size="m" disabled={selected.length === 0} loading={isCreating} onClick={handleCreate}>
        Создать issues ({selected.length})
      </Button>
    </div>
  );
}

export default BacklogPanel;
