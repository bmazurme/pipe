import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleQuestion, TrashBin } from '@gravity-ui/icons';
import { Alert, Button, Card, Checkbox, Icon, Label, Loader, SegmentedRadioGroup, Select, Text, TextInput } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import {
  getErrorMessage,
  type QuestionCard,
  useDeleteQuestionCardMutation,
  useDeleteQuestionMutation,
  useListQuestionCardsQuery,
  useSaveQuestionsAsContextMutation,
  useSetQuestionResolvedMutation,
} from '../../store/api';
import { EmptyState } from '../../widgets/EmptyState';
import { JobDetailDialog } from '../WorkerPage/JobDetailDialog';
import { PageHeader } from '../../widgets/PageHeader';
import styles from './QuestionsPage.module.css';

const POLL_INTERVAL_MS = 30_000;
const MAX_ANSWER_LENGTH = 2000;
// A delete is two clicks: the first arms the button, the second deletes; an armed button disarms itself after this long.
const ARM_MS = 3000;

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
  onDeleteQuestion: (id: number) => void;
  onDeleteCard: (taskKey: string) => void;
  disabled: boolean;
  contextSaved: boolean;
  contextUpdated: boolean;
}

function CardView({ card, onToggle, onAnswer, onSaveContext, onOpenJob, onDeleteQuestion, onDeleteCard, disabled, contextSaved, contextUpdated }: CardViewProps) {
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  // What is waiting for its second click: 'card' or `q:<id>`.
  const [armed, setArmed] = useState<string | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (armTimer.current) clearTimeout(armTimer.current);
    },
    [],
  );

  const confirm = (key: string, action: () => void) => {
    if (armTimer.current) clearTimeout(armTimer.current);

    if (armed === key) {
      setArmed(null);
      action();

      return;
    }

    setArmed(key);
    armTimer.current = setTimeout(() => setArmed(null), ARM_MS);
  };

  const hasAnswers = card.questions.some((question) => question.answer);

  const submitAnswer = (id: number) => {
    const draft = drafts[id] ?? '';

    if (disabled || !draft.trim()) return;

    onAnswer(id, draft);
    setDrafts((current) => ({ ...current, [id]: '' }));
  };

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
            <Button
              size="xs"
              view={armed === `q:${question.id}` ? 'flat-danger' : 'flat-secondary'}
              disabled={disabled}
              title={armed === `q:${question.id}` ? 'Нажмите ещё раз — удалить вопрос' : 'Удалить вопрос'}
              aria-label={armed === `q:${question.id}` ? `Подтвердить удаление вопроса: ${question.text}` : `Удалить вопрос: ${question.text}`}
              onClick={() => confirm(`q:${question.id}`, () => onDeleteQuestion(question.id))}
            >
              <Icon data={TrashBin} size={14} />
              {armed === `q:${question.id}` ? 'Удалить?' : null}
            </Button>
            {question.answer && <Text className={styles.answerText}>{question.answer}</Text>}
            {!question.resolved && (
              <form
                className={styles.answer}
                onSubmit={(event) => {
                  event.preventDefault();
                  submitAnswer(question.id);
                }}
              >
                <TextInput
                  size="s"
                  placeholder="Ответ"
                  value={drafts[question.id] ?? ''}
                  controlProps={{ maxLength: MAX_ANSWER_LENGTH, "aria-label": `Ответ: ${question.text}` }}
                  onUpdate={(value) => setDrafts((current) => ({ ...current, [question.id]: value }))}
                />
                <Button
                  size="s"
                  type="submit"
                  disabled={disabled || !(drafts[question.id] ?? '').trim()}
                >
                  Ответить
                </Button>
              </form>
            )}
          </li>
        ))}
      </ul>
      <div className={styles.cardActions}>
        {hasAnswers && (
          <Button size="s" view="outlined" disabled={disabled} onClick={() => onSaveContext(card.taskKey)}>
            Сохранить ответы как Context
          </Button>
        )}
        <Button
          size="s"
          view={armed === 'card' ? 'outlined-danger' : 'flat-secondary'}
          disabled={disabled}
          aria-label={armed === 'card' ? `Подтвердить удаление карточки ${card.taskKey}` : `Удалить карточку ${card.taskKey}`}
          onClick={() => confirm('card', () => onDeleteCard(card.taskKey))}
        >
          <Icon data={TrashBin} size={14} />
          {armed === 'card' ? 'Нажмите ещё раз — удалить карточку' : 'Удалить карточку'}
        </Button>
      </div>
      {hasAnswers && contextSaved && (
        <Text variant="caption-2" color="secondary" className={styles.answerText}>
          Context «Ответы: {card.taskKey}» {contextUpdated ? 'обновлён' : 'создан'} — выберите его при запуске следующего Worker job.
        </Text>
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
  const [deleteQuestion, { isLoading: isDeletingQuestion }] = useDeleteQuestionMutation();
  const [deleteCard, { isLoading: isDeletingCard }] = useDeleteQuestionCardMutation();
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

  const handleDeleteQuestion = async (id: number) => {
    setError(null);

    try {
      await deleteQuestion(id).unwrap();
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось удалить вопрос'));
    }
  };

  const handleDeleteCard = async (taskKey: string) => {
    setError(null);

    try {
      await deleteCard({ taskKey }).unwrap();
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось удалить карточку'));
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
                disabled={isSaving || isSavingContext || isDeletingQuestion || isDeletingCard}
                contextSaved={card.taskKey in savedContexts}
                contextUpdated={savedContexts[card.taskKey] === true}
                onToggle={(id, resolved) => void handleToggle(id, resolved)}
                onAnswer={(id, answer) => void handleAnswer(id, answer)}
                onSaveContext={(taskKey) => void handleSaveContext(taskKey)}
                onOpenJob={setOpenJobId}
                onDeleteQuestion={(id) => void handleDeleteQuestion(id)}
                onDeleteCard={(taskKey) => void handleDeleteCard(taskKey)}
              />
            </li>
          ))}
        </ul>
      )}

      {openJobId !== null && <JobDetailDialog jobId={openJobId} onClose={() => setOpenJobId(null)} />}
    </div>
  );
}
