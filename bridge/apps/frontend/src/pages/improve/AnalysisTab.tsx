import { useState } from 'react';
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
import { MODEL_OPTIONS } from '../worker/constants';
import styles from '../ImprovePage.module.css';
import { ALL_CATEGORIES, analysisItems, DEFAULT_CATEGORIES, CATEGORY_LABEL, isActiveRun, RUN_STATUS_LABEL, RUN_STATUS_THEME } from './improveLabels';

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
  const hasUnfiled = items.some((item) => !item.issueNumber && !item.duplicateOf);

  const handleCreate = async () => {
    setError(null);

    try {
      await createIssues({ id: run.id }).unwrap();
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось создать задачи'));
    }
  };

  const handleStart = async () => {
    setError(null);

    try {
      await startItems({ id: run.id, model }).unwrap();
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
        {items.map((item) => (
          <Text key={item.title} variant="caption-2" color="secondary">
            {CATEGORY_LABEL[item.category]} · {item.title} · риск: {item.risk}
            {item.issueNumber && ` · issue #${item.issueNumber}`}
            {item.started && ' · в работе'}
            {item.duplicateOf && ` · дубликат #${item.duplicateOf}`}
          </Text>
        ))}
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
        {run.status === 'analyzed' && hasUnfiled && (
          <Button view="outlined" size="s" loading={isLoading} onClick={() => void handleCreate()}>
            Создать issues
          </Button>
        )}
        {run.status === 'analyzed' && items.some((item) => !item.started && !item.duplicateOf) && (
          <Button view="action" size="s" loading={isStarting} onClick={() => void handleStart()}>
            В работу
          </Button>
        )}
      </div>
    </div>
  );
}

export function AnalysisTab({ configured }: { configured: boolean }) {
  const { data: runs, isLoading: isListLoading, isError: isListError, error: listError, refetch } = useListImproveRunsQuery(undefined, { pollingInterval: 10000, skipPollingIfUnfocused: true });
  const [start, { isLoading }] = useStartImproveAnalysisMutation();
  const [model, setModel] = useState('sonnet');
  const [categories, setCategories] = useState<AnalysisCategory[]>(DEFAULT_CATEGORIES);
  const [autoCreate, setAutoCreate] = useState(false);
  const [autoStart, setAutoStart] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyses = runs?.filter((run) => run.kind === 'analysis') ?? [];
  const busy = analyses.some((run) => isActiveRun(run));

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
      <div className={styles.toolbar}>
        <Select size="m" label="Модель:" value={[model]} onUpdate={([value]) => setModel(value)} options={MODEL_OPTIONS} />
        <Switch checked={autoCreate || autoStart} disabled={autoStart} onUpdate={setAutoCreate} content="Сразу создать issues" />
        <Switch checked={autoStart} onUpdate={setAutoStart} content="И сразу взять в работу" />
        <Button view="action" size="m" loading={isLoading} disabled={!configured || !runs || busy || categories.length === 0} onClick={() => void handleStart()}>
          Запустить анализ
        </Button>
      </div>
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
