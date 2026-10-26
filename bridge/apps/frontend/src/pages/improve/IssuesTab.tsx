import { useState } from 'react';
import { ArrowUpRightFromSquare, Rocket } from '@gravity-ui/icons';
import { Alert, Button, Checkbox, Icon, Label, Select, Skeleton, Switch, Text } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { getErrorMessage, ImproveIssue, useLazyListImproveIssuesQuery, useListImproveIssuesQuery, useStartImproveManyMutation, useStartImproveRunMutation } from '../../store/api';
import { EmptyState } from '../../widgets/EmptyState';
import { NewIssueDialog } from './NewIssueDialog';
import { MODEL_OPTIONS } from '../worker/constants';
import styles from '../ImprovePage.module.css';
import { blocksNewRun, readStoredModel, storeModel, RUN_STATUS_LABEL, RUN_STATUS_THEME } from './improveLabels';

export function IssuesTab({ configured }: { configured: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const { data: issues, isLoading, isError, error, isFetching } = useListImproveIssuesQuery({ all: showAll }, { skip: !configured });
  const [loadFresh] = useLazyListImproveIssuesQuery();
  const [start, { isLoading: isStarting }] = useStartImproveRunMutation();
  const [startMany, { isLoading: isStartingMany }] = useStartImproveManyMutation();
  const [selected, setSelected] = useState<number[]>([]);
  const [model, setModel] = useState(readStoredModel);
  const [batchKind, setBatchKind] = useState<'selected' | 'oldest' | null>(null);
  const [launching, setLaunching] = useState<number[]>([]);
  const [newIssueOpen, setNewIssueOpen] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const lock = (numbers: number[]) => setLaunching((prev) => [...prev, ...numbers]);
  const unlock = (numbers: number[]) => setLaunching((prev) => prev.filter((n) => !numbers.includes(n)));

  const handleStart = async (issue: ImproveIssue) => {
    setStartError(null);
    lock([issue.number]);

    try {
      await start({ issueNumber: issue.number, model }).unwrap();
    } catch (err) {
      setStartError(getErrorMessage(err, 'Не удалось запустить'));
    } finally {
      unlock([issue.number]);
    }
  };

  const startable = (issues ?? []).filter((issue) => !blocksNewRun(issue.run));

  const chosen = selected.filter((n) => startable.some((issue) => issue.number === n));

  const handleStartMany = async (kind: 'selected' | 'oldest', numbers: number[]) => {
    setStartError(null);
    setBatchKind(kind);
    lock(numbers);

    try {
      const result = await startMany({ issueNumbers: numbers, model }).unwrap();

      setSelected([]);
      if (result.skipped.length) setStartError(`Запущено ${result.started.length}; не запущено: ${result.skipped.join('; ')}`);
    } catch (err) {
      setStartError(getErrorMessage(err, 'Не удалось запустить'));
    } finally {
      setBatchKind(null);
      unlock(numbers);
    }
  };

  const handleModel = (value: string) => {
    setModel(value);
    storeModel(value);
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
        <Button
          view="action"
          size="m"
          disabled={chosen.length === 0 || isStartingMany}
          loading={isStartingMany && batchKind === 'selected'}
          onClick={() => void handleStartMany('selected', chosen)}
        >
          Запустить выбранные ({chosen.length})
        </Button>
        {startable.length > 0 && (
          <Button
            view="outlined"
            size="m"
            disabled={isStartingMany}
            loading={isStartingMany && batchKind === 'oldest'}
            onClick={() => void handleStartMany('oldest', startable.slice(0, 5).map((issue) => issue.number))}
          >
            Запустить {Math.min(5, startable.length)} старых
          </Button>
        )}
        <Button view="outlined" size="m" onClick={() => setNewIssueOpen(true)}>
          Новая задача
        </Button>
        <Button view="outlined" size="m" loading={isFetching} onClick={() => void loadFresh({ all: showAll, fresh: true })}>
          Обновить
        </Button>
        {launching.length > 0 && (
          <Text variant="caption-2" color="secondary">
            Готовим снимок репозитория — запуск может занять до минуты
          </Text>
        )}
      </div>

      <NewIssueDialog open={newIssueOpen} onClose={() => setNewIssueOpen(false)} defaultModel={model} />

      {startError && <Alert theme="danger" view="filled" message={startError} />}
      {isError && <Alert theme="danger" view="filled" message={getErrorMessage(error, 'Не удалось загрузить задачи')} />}

      {isLoading && <Skeleton style={{ height: 120 }} />}

      {issues && issues.length === 0 && (
        <EmptyState icon={Rocket} title="Открытых задач нет" description={showAll ? 'В репозитории нет открытых issues.' : 'Нет открытых issues с меткой loop — включите «Все открытые issues», создайте их из анализа или кнопкой «Новая задача».'} />
      )}

      {issues?.map((issue) => (
        <div key={issue.number} className={styles.row}>
          <Checkbox
            checked={selected.includes(issue.number)}
            disabled={blocksNewRun(issue.run) || launching.includes(issue.number)}
            controlProps={{ 'aria-label': `Выбрать #${issue.number}` }}
            onUpdate={(on) => setSelected(on ? [...selected, issue.number] : selected.filter((n) => n !== issue.number))}
          />
          <div className={styles.rowMain}>
            <Text variant="body-2" ellipsis title={issue.title}>
              <a href={issue.htmlUrl} target="_blank" rel="noreferrer noopener" aria-label={`Issue #${issue.number} на GitHub: ${issue.title}`}>
                #{issue.number} {issue.title}
              </a>
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
              disabled={blocksNewRun(issue.run) || launching.includes(issue.number)}
              loading={isStarting && launching.includes(issue.number)}
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
