import { useState } from 'react';
import { ArrowUpRightFromSquare, Rocket } from '@gravity-ui/icons';
import { Alert, Button, Checkbox, Icon, Label, Select, Skeleton, Switch, Text } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { getErrorMessage, ImproveIssue, useListImproveIssuesQuery, useStartImproveManyMutation, useStartImproveRunMutation } from '../../store/api';
import { EmptyState } from '../../widgets/EmptyState';
import { MODEL_OPTIONS } from '../worker/constants';
import styles from '../ImprovePage.module.css';
import { blocksNewRun, RUN_STATUS_LABEL, RUN_STATUS_THEME } from './improveLabels';

const MODEL_KEY = 'improve.model';

function readModel(): string {
  try {
    const value = localStorage.getItem(MODEL_KEY);

    return MODEL_OPTIONS.some((option) => option.value === value) ? (value as string) : 'sonnet';
  } catch {
    return 'sonnet';
  }
}

export function IssuesTab({ configured }: { configured: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const { data: issues, isLoading, isError, error, refetch, isFetching } = useListImproveIssuesQuery({ all: showAll }, { skip: !configured });
  const [start, { isLoading: isStarting }] = useStartImproveRunMutation();
  const [startMany, { isLoading: isStartingMany }] = useStartImproveManyMutation();
  const [selected, setSelected] = useState<number[]>([]);
  const [model, setModel] = useState(readModel);
  const [startingFor, setStartingFor] = useState<number | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const handleStart = async (issue: ImproveIssue) => {
    setStartError(null);
    setStartingFor(issue.number);

    try {
      await start({ issueNumber: issue.number, model }).unwrap();
    } catch (err) {
      setStartError(getErrorMessage(err, 'Не удалось запустить'));
    } finally {
      setStartingFor(null);
    }
  };

  const startable = (issues ?? []).filter((issue) => !blocksNewRun(issue.run));

  const handleStartMany = async (numbers: number[]) => {
    setStartError(null);

    try {
      const result = await startMany({ issueNumbers: numbers, model }).unwrap();

      setSelected([]);
      if (result.skipped.length) setStartError(`Запущено ${result.started.length}; не запущено: ${result.skipped.join('; ')}`);
    } catch (err) {
      setStartError(getErrorMessage(err, 'Не удалось запустить'));
    }
  };

  const handleModel = (value: string) => {
    setModel(value);
    try {
      localStorage.setItem(MODEL_KEY, value);
    } catch {
      // Not remembering the choice is fine.
    }
  };

  if (!configured) return null;

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <Select
          size="m"
          label="Модель:"
          value={[model]}
          onUpdate={([value]) => handleModel(value)}
          options={MODEL_OPTIONS}
        />
        <Switch checked={showAll} onUpdate={setShowAll} content="Все открытые issues" />
        <Button view="action" size="m" disabled={selected.length === 0} loading={isStartingMany} onClick={() => void handleStartMany(selected)}>
          Запустить выбранные ({selected.length})
        </Button>
        <Button
          view="outlined"
          size="m"
          disabled={startable.length === 0}
          loading={isStartingMany}
          onClick={() => void handleStartMany(startable.slice(0, 5).map((issue) => issue.number))}
        >
          Запустить {Math.min(5, startable.length)} старых
        </Button>
        <Button view="outlined" size="m" loading={isFetching} onClick={() => void refetch()}>
          Обновить
        </Button>
      </div>

      {startError && <Alert theme="danger" view="filled" message={startError} />}
      {isError && <Alert theme="danger" view="filled" message={getErrorMessage(error, 'Не удалось загрузить задачи')} />}

      {isLoading && <Skeleton style={{ height: 120 }} />}

      {issues && issues.length === 0 && (
        <EmptyState icon={Rocket} title="Открытых задач нет" description={showAll ? 'В репозитории нет открытых issues.' : 'Нет открытых issues с меткой loop — включите «Все открытые issues», создайте их из анализа или вручную на GitHub.'} />
      )}

      {issues?.map((issue) => (
        <div key={issue.number} className={styles.row}>
          <Checkbox
            checked={selected.includes(issue.number)}
            disabled={blocksNewRun(issue.run)}
            controlProps={{ 'aria-label': `Выбрать #${issue.number}` }}
            onUpdate={(on) => setSelected(on ? [...selected, issue.number] : selected.filter((n) => n !== issue.number))}
          />
          <div className={styles.rowMain}>
            <Text variant="body-2" ellipsis title={issue.title}>
              #{issue.number} {issue.title}
            </Text>
            <Text variant="caption-2" color="secondary">
              создана {formatRelativeTime(issue.createdAt)}
              {showAll && !issue.labels.includes('loop') && ' · без метки loop'}
              {issue.run?.note && ` · ${issue.run.note}`}
              {issue.run?.error && ` · ${issue.run.error}`}
            </Text>
          </div>
          <div className={styles.rowActions}>
            {issue.run && <Label theme={RUN_STATUS_THEME[issue.run.status]}>{RUN_STATUS_LABEL[issue.run.status]}</Label>}
            {issue.run?.prUrl && (
              <a href={issue.run.prUrl} target="_blank" rel="noreferrer noopener" aria-label={`PR #${issue.run.prNumber}`}>
                <Icon data={ArrowUpRightFromSquare} size={16} />
              </a>
            )}
            <Button
              view="action"
              size="s"
              disabled={blocksNewRun(issue.run)}
              loading={isStarting && startingFor === issue.number}
              onClick={() => void handleStart(issue)}
              aria-label={`Запустить #${issue.number}`}
            >
              Запустить
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
