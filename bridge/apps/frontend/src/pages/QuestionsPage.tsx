import { useState } from 'react';
import { CircleQuestion } from '@gravity-ui/icons';
import { Alert, Card, Checkbox, Label, Loader, SegmentedRadioGroup, Text } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../shared/lib/formatRelativeTime';
import { getErrorMessage, type QuestionCard, useListQuestionCardsQuery, useSetQuestionResolvedMutation } from '../store/api';
import { EmptyState } from '../widgets/EmptyState';
import { PageHeader } from '../widgets/PageHeader';
import styles from './QuestionsPage.module.css';

const POLL_INTERVAL_MS = 30_000;

type View = 'open' | 'archive';

function CardView({ card, onToggle, disabled }: { card: QuestionCard; onToggle: (id: number, resolved: boolean) => void; disabled: boolean }) {
  return (
    <Card type="container" view="outlined" className={styles.card}>
      <div className={styles.cardHeader}>
        <Label theme={card.project ? 'info' : 'unknown'} aria-label="Проект">
          {card.project ? `Проект ${card.project}` : 'Без проекта'}
        </Label>
        <Text variant="subheader-1">{card.taskKey}</Text>
        <Text variant="caption-2" color="secondary" className={styles.cardMeta}>
          {card.archived ? 'все закрыты' : `открыто: ${card.openCount} из ${card.questions.length}`} · {formatRelativeTime(card.updatedAt)}
        </Text>
      </div>
      <ul className={styles.questions}>
        {card.questions.map((question) => (
          <li key={question.id}>
            <Checkbox
              checked={question.resolved}
              disabled={disabled}
              onUpdate={(checked) => onToggle(question.id, checked)}
              content={
                <Text color={question.resolved ? 'secondary' : 'primary'} className={styles.question}>
                  {question.resolved ? <s>{question.text}</s> : question.text}
                </Text>
              }
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function QuestionsPage() {
  const [view, setView] = useState<View>('open');
  const { data: cards, isLoading, isError } = useListQuestionCardsQuery(
    { archived: view === 'archive' },
    { pollingInterval: POLL_INTERVAL_MS, skipPollingIfUnfocused: true },
  );
  const [setResolved, { isLoading: isSaving }] = useSetQuestionResolvedMutation();
  const [error, setError] = useState<string | null>(null);

  const handleToggle = async (id: number, resolved: boolean) => {
    setError(null);

    try {
      await setResolved({ id, resolved }).unwrap();
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось обновить вопрос'));
    }
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title="Questions"
        description="Открытые вопросы по задачам. Worker достаёт их из вывода запуска; отметьте вопрос, когда он закрыт. Когда закрыты все вопросы задачи, её карточка уходит в архив — новый вопрос по ней вернёт её обратно."
        actions={
          <SegmentedRadioGroup value={view} onUpdate={(value) => setView(value as View)} aria-label="Показать">
            <SegmentedRadioGroup.Option value="open">Открытые</SegmentedRadioGroup.Option>
            <SegmentedRadioGroup.Option value="archive">Архив</SegmentedRadioGroup.Option>
          </SegmentedRadioGroup>
        }
      />

      {isError && <Alert theme="danger" view="filled" message="Не удалось загрузить вопросы" />}
      {error && <Alert theme="danger" view="filled" message={error} />}

      {isLoading && (
        <div className={styles.centered}>
          <Loader size="m" />
        </div>
      )}

      {cards && cards.length === 0 && (
        <EmptyState
          icon={CircleQuestion}
          title={view === 'open' ? 'Открытых вопросов нет' : 'Архив пуст'}
          description={
            view === 'open'
              ? 'Когда запуск оставит вопросы без ответа, они появятся здесь карточкой с номером проекта.'
              : 'Сюда попадают задачи, у которых закрыты все вопросы.'
          }
        />
      )}

      {cards && cards.length > 0 && (
        <ul className={styles.list}>
          {cards.map((card) => (
            <li key={card.taskKey}>
              <CardView card={card} disabled={isSaving} onToggle={(id, resolved) => void handleToggle(id, resolved)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
