import { useEffect, useState } from 'react';
import { Alert, Button, Card, Select, Skeleton, Switch, Text, TextArea, TextInput } from '@gravity-ui/uikit';

import {
  type LabExecutor,
  type LabRouting,
  type RouterRule,
  type RouterSettings,
  useGetRouterSettingsQuery,
  usePreviewRoutingMutation,
  useSaveRouterSettingsMutation,
} from '../../store/api';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../ImprovePage.module.css';
import { useModelOptions } from '../worker/useModelOptions';
import { EXECUTOR_OPTIONS } from './executors';

const TIERS = ['1', '2', '3', '4'] as const;

const TIER_HINT: Record<(typeof TIERS)[number], string> = {
  '1': 'Ярус 1 — правка в один-два файла, до нескольких десятков строк: опечатка, документ, один тест',
  '2': 'Ярус 2 — несколько файлов в одной области, до ~200 строк',
  '3': 'Ярус 3 — несколько файлов или две области, до ~600 строк',
  '4': 'Ярус 4 — больше этого, или работа с многократным запуском сборки и миграций',
};

const EMPTY_RULE: RouterRule = { name: '', keywords: '', model: 'sonnet', enabled: true };

// What "Авто" does: reads how big a task is (a short question to Haiku), and sends it to the model of its tier — or, when its words match a
// rule, to the model that rule fixes. Tried out here without starting anything.
export function RouterTab() {
  const { data, isLoading, isError } = useGetRouterSettingsQuery();
  const [save, { isLoading: isSaving }] = useSaveRouterSettingsMutation();
  const [preview, { isLoading: isPreviewing }] = usePreviewRoutingMutation();
  const { options } = useModelOptions();
  const [draft, setDraft] = useState<RouterSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [task, setTask] = useState('');
  const [executor, setExecutor] = useState<LabExecutor>('any');
  const [decision, setDecision] = useState<LabRouting | null>(null);

  useEffect(() => {
    if (data && !draft) setDraft(data);
  }, [data, draft]);

  if (isLoading || (!draft && !isError)) return <Skeleton height={160} />;
  if (isError || !draft) return <Alert theme="danger" view="filled" message="Не удалось загрузить настройки маршрутизатора" />;

  const edit = (next: RouterSettings) => {
    setDraft(next);
    setSaved(false);
  };
  const setRule = (index: number, patch: Partial<RouterRule>) => edit({ ...draft, rules: draft.rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)) });

  const handleSave = async () => {
    setError(null);

    try {
      await save(draft).unwrap();
      setSaved(true);
    } catch (err) {
      setError(typeof err === 'string' ? err : 'Не удалось сохранить настройки');
    }
  };

  const handlePreview = async () => {
    setError(null);
    setDecision(null);

    try {
      setDecision(await preview({ task: task.trim(), executor }).unwrap());
    } catch (err) {
      setError(typeof err === 'string' ? err : 'Не удалось определить модель');
    }
  };

  return (
    <div className={styles.panel}>
      <Card view="outlined" className={styles.card}>
        <SectionHeader title="Авто: модель по размеру задачи" />
        <Text color="secondary" variant="caption-2">
          В запуске или расписании Lab выберите модель «Авто»: перед стартом Haiku оценивает по тексту, насколько велика правка (ярус 1–4), и задача уходит на модель этого яруса. Если Claude недоступен —
          Sonnet. Задачам, которым нужны сгенерированные файлы или миграции, и Fusion 360 нужна модель Claude: другая заменится на Sonnet, и это будет сказано в запуске.
        </Text>

        {TIERS.map((tier) => (
          <div key={tier} className={styles.toolbar}>
            <Select
              size="m"
              label={`Ярус ${tier}:`}
              value={[draft.tierModels[tier]]}
              onUpdate={([model]) => model && edit({ ...draft, tierModels: { ...draft.tierModels, [tier]: model } })}
              options={options}
              width={260}
            />
            <Text color="secondary" variant="caption-2">
              {TIER_HINT[tier]}
            </Text>
          </div>
        ))}
      </Card>

      <Card view="outlined" className={styles.card}>
        <SectionHeader title="Правила: слова → строго заданная модель" meta={draft.rules.length > 0 ? String(draft.rules.length) : undefined} />
        <Text color="secondary" variant="caption-2">
          Задача, в тексте которой есть любое из ключевых слов, идёт на модель правила — независимо от размера (и без вопроса к Haiku). Например: «aliexpress» → Opus. Срабатывает первое включённое правило сверху.
        </Text>

        {draft.rules.map((rule, index) => (
          <div key={index} className={styles.panel}>
            <div className={styles.toolbar}>
              <TextInput value={rule.name} onUpdate={(name) => setRule(index, { name })} placeholder="Название правила" controlProps={{ 'aria-label': 'Название правила' }} />
              <Select
                size="m"
                label="Модель:"
                value={[rule.model]}
                onUpdate={([model]) => model && setRule(index, { model })}
                options={options}
                width={260}
              />
              <Switch checked={rule.enabled} onUpdate={(enabled) => setRule(index, { enabled })} content="Включено" />
              <Button view="flat-danger" size="s" onClick={() => edit({ ...draft, rules: draft.rules.filter((_, i) => i !== index) })}>
                Удалить
              </Button>
            </div>
            <TextArea
              value={rule.keywords}
              onUpdate={(keywords) => setRule(index, { keywords })}
              rows={2}
              placeholder="Ключевые слова — по одному в строке или через запятую: aliexpress, алиэкспресс"
              controlProps={{ 'aria-label': 'Ключевые слова' }}
            />
          </div>
        ))}

        <div>
          <Button view="outlined" disabled={draft.rules.length >= 20} onClick={() => edit({ ...draft, rules: [...draft.rules, { ...EMPTY_RULE }] })}>
            Добавить правило
          </Button>
        </div>
      </Card>

      <div className={styles.toolbar}>
        <Button view="action" loading={isSaving} onClick={() => void handleSave()}>
          Сохранить
        </Button>
        {saved && <Text color="positive">Сохранено</Text>}
      </div>
      {error && <Alert theme="danger" view="filled" message={error} />}

      <Card view="outlined" className={styles.card}>
        <SectionHeader title="Проверить на задаче" />
        <Text color="secondary" variant="caption-2">
          Покажет, какую модель выберет «Авто» для этого текста, ничего не запуская (сохранённые настройки; это один короткий вопрос к Haiku, если правило не сработало по словам).
        </Text>
        <TextArea value={task} onUpdate={setTask} rows={3} placeholder="Текст задачи" controlProps={{ 'aria-label': 'Текст задачи' }} />
        <div className={styles.toolbar}>
          <Select size="m" label="Где выполнять:" value={[executor]} onUpdate={([value]) => setExecutor((value as LabExecutor) ?? 'any')} options={EXECUTOR_OPTIONS} width={240} />
          <Button view="normal" loading={isPreviewing} disabled={task.trim().length < 3} onClick={() => void handlePreview()}>
            Показать выбор
          </Button>
        </div>
        {decision && <Alert theme="info" view="outlined" message={decision.reason} />}
      </Card>
    </div>
  );
}
