import { useEffect, useState } from 'react';
import { Magnifier } from '@gravity-ui/icons';
import { Alert, Button, Checkbox, Label, Loader, Select, Switch, Text } from '@gravity-ui/uikit';

import {
  AnalysisCategory,
  getErrorMessage,
  ImproveRun,
  useCreateImproveIssuesMutation,
  useGetImproveRunQuery,
  useListImproveRunsQuery,
  useStartImproveAnalysisMutation,
  useStartImproveItemsMutation,
} from '../../store/api';
import { EmptyState } from '../../widgets/EmptyState';
import { useModelOptions } from '../worker/useModelOptions';
import styles from '../ImprovePage.module.css';
import { ALL_CATEGORIES, analysisItems, DEFAULT_CATEGORIES, CATEGORY_LABEL, FAST_POLL_MS, isActiveRun, readStoredModel, storeModel, RUN_STATUS_LABEL, RUN_STATUS_THEME, SLOW_POLL_MS } from './improveLabels';

// "польза 4/5 · объём s" — what the analysis rated the proposal; nothing for an analysis made before it rated them.
function priorityText(item: { value?: number; effort?: string }): string {
  return item.value ? ` · польза: ${item.value}/5 · объём: ${item.effort ?? 'm'}` : '';
}

function AnalysisRun({ run, model }: { run: ImproveRun; model: string }) {
  const [createIssues, { isLoading }] = useCreateImproveIssuesMutation();
  const [startItems, { isLoading: isStarting }] = useStartImproveItemsMutation();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // Fetched only once the user opens the run, and polled only while it is active.
  const { data: detail, isError: detailError } = useGetImproveRunQuery(run.id, {
    skip: !open,
    pollingInterval: isActiveRun(run) ? 5000 : 0,
  });
  const items = detail ? analysisItems(detail) : [];
  // Positions (in `items`) of the only proposals either action can touch: not filed, not started, not a duplicate.
  const selectable = items.reduce<number[]>((indices, item, index) => (!item.issueNumber && !item.duplicateOf && !item.started ? [...indices, index] : indices), []);
  // Empty by default: every selectable proposal counts as ticked until the owner unticks one, so the one-click
  // behaviour is unchanged. Tracking what's unticked (not ticked) means a proposal that drops out of `selectable`
  // (filed, started, found a duplicate) is never sent again, whether or not its index was ever toggled.
  const [untickedIndices, setUntickedIndices] = useState<ReadonlySet<number>>(new Set());
  const tickedIndices = selectable.filter((index) => !untickedIndices.has(index));

  const toggle = (index: number) =>
    setUntickedIndices((current) => {
      const next = new Set(current);

      if (next.has(index)) next.delete(index);
      else next.add(index);

      return next;
    });

  const handleCreate = async () => {
    setError(null);

    try {
      await createIssues({ id: run.id, indices: tickedIndices }).unwrap();
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось создать задачи'));
    }
  };

  const handleStart = async () => {
    setError(null);

    try {
      await startItems({ id: run.id, model, indices: tickedIndices }).unwrap();
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось взять в работу'));
    }
  };

  return (
    <div className={styles.row}>
      <div className={styles.rowMain}>
        <Text variant="body-2">{run.issueTitle}</Text>
        {open && !detail && !detailError && <Text variant="caption-2" color="secondary">Загрузка…</Text>}
        {open && !detail && detailError && <Text variant="caption-2" color="danger">Не удалось загрузить предложения</Text>}
        {items.map((item, index) =>
          selectable.includes(index) ? (
            <Checkbox key={item.title} checked={tickedIndices.includes(index)} onUpdate={() => toggle(index)}>
              <Text variant="caption-2" color="secondary">
                {CATEGORY_LABEL[item.category]} · {item.title} · риск: {item.risk}{priorityText(item)}
              </Text>
            </Checkbox>
          ) : (
            <Text key={item.title} variant="caption-2" color="secondary">
              {CATEGORY_LABEL[item.category]} · {item.title} · риск: {item.risk}{priorityText(item)}
              {item.skipped && ` · придержано: ${item.skipped}`}
              {item.issueNumber && ` · issue #${item.issueNumber}`}
              {item.started && ' · в работе'}
              {item.duplicateOf && ` · дубликат #${item.duplicateOf}`}
            </Text>
          ),
        )}
        {run.note && <Text variant="caption-2" color="secondary">{run.note}</Text>}
        {run.error && <Text variant="caption-2" color="danger">{run.error}</Text>}
        {error && <Text variant="caption-2" color="danger">{error}</Text>}
      </div>
      <div className={styles.rowActions}>
        <Label theme={RUN_STATUS_THEME[run.status]}>{RUN_STATUS_LABEL[run.status]}</Label>
        {run.hasResult && (
          <Button view="flat" size="s" onClick={() => setOpen(!open)}>
            {open ? 'Скрыть предложения' : 'Показать предложения'}
          </Button>
        )}
        {run.status === 'analyzed' && selectable.length > 0 && (
          <Button
            view="outlined"
            size="s"
            loading={isLoading}
            disabled={tickedIndices.length === 0}
            title={tickedIndices.length === 0 ? 'Отметьте хотя бы одно предложение' : undefined}
            onClick={() => void handleCreate()}
          >
            Создать issues ({tickedIndices.length})
          </Button>
        )}
        {run.status === 'analyzed' && selectable.length > 0 && (
          <Button
            view="action"
            size="s"
            loading={isStarting}
            disabled={tickedIndices.length === 0}
            title={tickedIndices.length === 0 ? 'Отметьте хотя бы одно предложение' : undefined}
            onClick={() => void handleStart()}
          >
            В работу ({tickedIndices.length})
          </Button>
        )}
      </div>
    </div>
  );
}

export function AnalysisTab({ configured }: { configured: boolean }) {
  const { options: modelOptions } = useModelOptions();
  // Fast while any run (an analysis or an issue run) is working, slow otherwise, paused in a background tab.
  const [pollingInterval, setPollingInterval] = useState(FAST_POLL_MS);
  const { data: runs, isLoading: isListLoading, isError: isListError, error: listError, refetch } = useListImproveRunsQuery(undefined, { pollingInterval, skipPollingIfUnfocused: true });
  const hasActive = Boolean(runs?.some((run) => isActiveRun(run)));

  useEffect(() => {
    setPollingInterval(hasActive ? FAST_POLL_MS : SLOW_POLL_MS);
  }, [hasActive]);
  const [start, { isLoading }] = useStartImproveAnalysisMutation();
  const [model, setModel] = useState(readStoredModel);
  const [categories, setCategories] = useState<AnalysisCategory[]>(DEFAULT_CATEGORIES);
  const [autoCreate, setAutoCreate] = useState(false);
  const [autoStart, setAutoStart] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyses = runs?.filter((run) => run.kind === 'analysis') ?? [];
  const busy = analyses.some((run) => isActiveRun(run));

  const handleModel = (value: string) => {
    setModel(value);
    storeModel(value);
  };

  const toggle = (category: AnalysisCategory, on: boolean) =>
    setCategories(on ? [...categories, category] : categories.filter((c) => c !== category));

  const handleStart = async () => {
    setError(null);

    try {
      await start({ model, categories, autoCreate: autoCreate || autoStart, autoStart }).unwrap();
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось запустить анализ'));
    }
  };

  return (
    <div className={styles.panel}>
      <Text color="secondary" variant="body-2">
        Worker изучает репозиторий и предлагает ровно одну задачу на каждое выбранное направление. Расписание анализа настраивается на вкладке «Расписания».
      </Text>
      <div className={styles.toolbar}>
        {ALL_CATEGORIES.map((category) => (
          <Checkbox key={category} checked={categories.includes(category)} onUpdate={(on) => toggle(category, on)} content={CATEGORY_LABEL[category]} />
        ))}
      </div>
      <Text color="secondary" variant="caption-2">
        «Новые фичи» — не исправление, а предложение новой возможности в рамках этого проекта: worker опирается на CLAUDE.md, README и то, что уже есть в
        приложении, и называет модуль, который он расширяет. По умолчанию выключено.
      </Text>
      <Text color="secondary" variant="caption-2">
        «Рефакторинг» — небольшая правка кода без изменения поведения: дублирование, слишком длинная функция, запутанное условие, мёртвый код, лишний any.
        Worker называет файл и функцию, как код выглядит сейчас и каким должен стать, и чем подтверждается, что поведение то же. Не путать с «Архитектурой»
        (границы модулей и зависимости). По умолчанию выключено.
      </Text>
      <div className={styles.toolbar}>
        <Select size="m" label="Модель:" value={[model]} onUpdate={([value]) => handleModel(value)} options={modelOptions} />
        <Switch checked={autoCreate || autoStart} disabled={autoStart} onUpdate={setAutoCreate} content="Сразу создать issues" />
        <Switch checked={autoStart} onUpdate={setAutoStart} content="И сразу взять в работу" />
        <Button view="action" size="m" loading={isLoading} disabled={!configured || !runs || busy || categories.length === 0} onClick={() => void handleStart()}>
          Запустить анализ
        </Button>
      </div>
      {!busy && categories.length === 0 && (
        <Text color="warning" variant="caption-2">
          Выберите хотя бы одно направление, чтобы запустить анализ.
        </Text>
      )}
      {busy && (
        <Text color="secondary" variant="caption-2">
          Анализ уже выполняется — новый запустится, когда он закончится.
        </Text>
      )}
      {error && <Alert theme="danger" view="filled" message={error} />}

      {isListLoading && <Loader size="m" />}
      {isListError && (
        <Alert
          theme="danger"
          view="filled"
          message={getErrorMessage(listError, 'Не удалось загрузить анализы')}
          actions={
            <Button view="outlined" size="s" onClick={() => void refetch()}>
              Повторить
            </Button>
          }
        />
      )}
      {runs && analyses.length === 0 && (
        <EmptyState icon={Magnifier} title="Анализов ещё не было" description="Запустите анализ вручную или добавьте расписание." />
      )}
      {analyses.map((run) => (
        <AnalysisRun key={run.id} run={run} model={model} />
      ))}
    </div>
  );
}
