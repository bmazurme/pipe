import { useMemo, useState } from 'react';
import { CircleQuestion } from '@gravity-ui/icons';
import { Alert, Button, Card, Checkbox, Label, Loader, SegmentedRadioGroup, Select, Text, TextInput } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../shared/lib/formatRelativeTime';
import { getErrorMessage, type QuestionCard, useListQuestionCardsQuery, useSaveQuestionsAsContextMutation, useSetQuestionResolvedMutation } from '../store/api';
import { EmptyState } from '../widgets/EmptyState';
import { JobDetailDialog } from './worker/JobDetailDialog';
import { PageHeader } from '../widgets/PageHeader';
import styles from './QuestionsPage.module.css';

const POLL_INTERVAL_MS = 30_000;
const MAX_ANSWER_LENGTH = 2000;

type View = 'open' | 'archive';

const ALL_PROJECTS = 'all';
const NO_PROJECT = 'none';
const projectValue = (project: string) => `project:${project}`;

interface CardViewProps {
  card: QuestionCard;
  onToggle: (id: number, resolved: boolean) => void;
  onAnswer: (id: number, answer: string) => void;
  onSaveContext: (taskKey: string) => void;
  onOpenJob: (jobId: number) => void;
  disabled: boolean;
  contextSaved: boolean;
  contextUpdated: boolean;
}

function CardView({ card, onToggle, onAnswer, onSaveContext, onOpenJob, disabled, contextSaved, contextUpdated }: CardViewProps) {
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const hasAnswers = card.questions.some((question) => question.answer);

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
            {question.jobId !== null && (
              <Button size="xs" view="flat" onClick={() => onOpenJob(question.jobId as number)}>
                Запуск #{question.jobId}
              </Button>
            )}
            {question.answer && <Text className={styles.answerText}>{question.answer}</Text>}
            {!question.resolved && (
              <div className={styles.answer}>
                <TextInput
                  size="s"
                  placeholder="Ответ"
                  value={drafts[question.id] ?? ''}
                  controlProps={{ maxLength: MAX_ANSWER_LENGTH, "aria-label": `Ответ: ${question.text}` }}
                  onUpdate={(value) => setDrafts((current) => ({ ...current, [question.id]: value }))}
                />
                <Button
                  size="s"
                  disabled={disabled || !(drafts[question.id] ?? '').trim()}
                  onClick={() => {
                    onAnswer(question.id, drafts[question.id]);
                    setDrafts((current) => ({ ...current, [question.id]: '' }));
                  }}
                >
                  Ответить
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {hasAnswers && (
        <div>
          <Button size="s" view="outlined" disabled={disabled} onClick={() => onSaveContext(card.taskKey)}>
            Сохранить ответы как Context
          </Button>
          {contextSaved && (
            <Text variant="caption-2" color="secondary" className={styles.answerText}>
              Context «Ответы: {card.taskKey}» {contextUpdated ? 'обновлён' : 'создан'} — выберите его при запуске следующего Worker job.
            </Text>
          )}
        </div>
      )}
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
  const [saveContext, { isLoading: isSavingContext }] = useSaveQuestionsAsContextMutation();
  const [savedContexts, setSavedContexts] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [openJobId, setOpenJobId] = useState<number | null>(null);
  const [projectFilter, setProjectFilter] = useState(ALL_PROJECTS);

  const projectOptions = useMemo(() => {
    const projects = [...new Set((cards ?? []).flatMap((card) => (card.project ? [card.project] : [])))].sort((a, b) => Number(a) - Number(b));
    const options = projects.map((project) => ({ value: projectValue(project), content: `Проект ${project}` }));

    if ((cards ?? []).some((card) => !card.project)) options.push({ value: NO_PROJECT, content: 'Без проекта' });

    return options;
  }, [cards]);

  // A chosen project that is gone from the polled data falls back to "all".
  const activeFilter = projectOptions.some((option) => option.value === projectFilter) ? projectFilter : ALL_PROJECTS;
  const visibleCards = (cards ?? []).filter(
    (card) => activeFilter === ALL_PROJECTS || (activeFilter === NO_PROJECT ? !card.project : projectValue(card.project ?? '') === activeFilter),
  );
  const filterLabel = projectOptions.find((option) => option.value === activeFilter)?.content;

  const handleToggle = async (id: number, resolved: boolean) => {
    setError(null);

    try {
      await setResolved({ id, resolved }).unwrap();
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось обновить вопрос'));
    }
  };

  const handleAnswer = async (id: number, answer: string) => {
    setError(null);

    try {
      await setResolved({ id, answer }).unwrap();
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось сохранить ответ'));
    }
  };

  const handleSaveContext = async (taskKey: string) => {
    setError(null);

    try {
      const { updated } = await saveContext({ taskKey }).unwrap();
      setSavedContexts((current) => ({ ...current, [taskKey]: updated }));
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось создать Context'));
    }
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title="Questions"
        description="Открытые вопросы по задачам. Worker достаёт их из вывода запуска; отметьте вопрос, когда он закрыт. Когда закрыты все вопросы задачи, её карточка уходит в архив — новый вопрос по ней вернёт её обратно."
        actions={
          <>
            {projectOptions.length >= 2 && (
              <Select
                label="Проект"
                value={[activeFilter]}
                options={[{ value: ALL_PROJECTS, content: 'Все проекты' }, ...projectOptions]}
                onUpdate={(value) => setProjectFilter(value[0] ?? ALL_PROJECTS)}
              />
            )}
            <SegmentedRadioGroup value={view} onUpdate={(value) => setView(value as View)} aria-label="Показать">
              <SegmentedRadioGroup.Option value="open">Открытые</SegmentedRadioGroup.Option>
              <SegmentedRadioGroup.Option value="archive">Архив</SegmentedRadioGroup.Option>
            </SegmentedRadioGroup>
          </>
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

      {cards && cards.length > 0 && visibleCards.length === 0 && (
        <EmptyState icon={CircleQuestion} title={`Нет вопросов по проекту ${(filterLabel ?? '').replace('Проект ', '')}`.trim()} />
      )}

      {visibleCards.length > 0 && (
        <ul className={styles.list}>
          {visibleCards.map((card) => (
            <li key={card.taskKey}>
              <CardView
                card={card}
                disabled={isSaving || isSavingContext}
                contextSaved={card.taskKey in savedContexts}
                contextUpdated={savedContexts[card.taskKey] === true}
                onToggle={(id, resolved) => void handleToggle(id, resolved)}
                onAnswer={(id, answer) => void handleAnswer(id, answer)}
                onSaveContext={(taskKey) => void handleSaveContext(taskKey)}
                onOpenJob={setOpenJobId}
              />
            </li>
          ))}
        </ul>
      )}

      {openJobId !== null && <JobDetailDialog jobId={openJobId} onClose={() => setOpenJobId(null)} />}
    </div>
  );
}
