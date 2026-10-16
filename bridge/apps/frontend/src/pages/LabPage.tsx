import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Loader, Text, TextArea, TextInput } from '@gravity-ui/uikit';

import { useLocalStorage } from '../shared/hooks/useLocalStorage';
import { PageHeader } from '../widgets/PageHeader';
import styles from './LabPage.module.css';

// Lab is its own standalone Python project/CLI (build123d-based CAD + calc + BOM) — see
// Lab/README.md and Lab/IMPLEMENTATION_PLAN.md in the repo. Its backend stays exactly that;
// this page is the *interface* to it, as agreed: Lab only ever hands over data (`lab serve`,
// core/webui.py — a small JSON API, CORS-enabled, no auth), and every bit of presentation
// lives here instead of in a page Lab would have to render itself. Called directly from the
// browser, not through bridge's own backend, which stays entirely unaware Lab exists — the
// "low coupling" decision in IMPLEMENTATION_PLAN.md.
const LAB_URL_STORAGE_KEY = 'pipe.labApiUrl';
const DEFAULT_LAB_URL = 'http://localhost:8765';
const FETCH_TIMEOUT_MS = 5000;

interface MetricSummary {
  predicted_count: number;
  measured_count: number;
  latest_predicted: number | null;
  latest_measured: number | null;
  diff_pct: number | null;
}

interface StatsResponse {
  project: string;
  summary: Record<string, MetricSummary>;
}

interface HistoryRecord {
  timestamp: string;
  kind: 'predicted' | 'measured';
  metrics: Record<string, number>;
  note: string;
}

// `lab serve`'s own parser (core/stats.py:parse_assignments) re-implemented here — the two
// never share code (different languages), but should read the same input the same way and
// fail with the same kind of message either way.
function parseAssignments(text: string): Record<string, number> {
  const metrics: Record<string, number> = {};

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const splitAt = line.indexOf('=');
    if (splitAt === -1) throw new Error(`Ожидался key=value, получено «${line}»`);

    const key = line.slice(0, splitAt).trim();
    const rawValue = line.slice(splitAt + 1).trim();
    const value = Number(rawValue);

    if (!key || rawValue === '' || Number.isNaN(value)) {
      throw new Error(`Значение «${rawValue}» для «${key}» не число`);
    }

    metrics[key] = value;
  }

  return metrics;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  return response.json() as Promise<T>;
}

function formatNumber(value: number | null): string {
  if (value === null) return '—';

  return Number.isInteger(value) ? String(value) : value.toPrecision(4).replace(/\.?0+$/, '');
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ru-RU');
  } catch {
    return iso;
  }
}

export function LabPage() {
  const [labUrl, setLabUrl] = useLocalStorage(LAB_URL_STORAGE_KEY, DEFAULT_LAB_URL);
  const [urlDraft, setUrlDraft] = useState(labUrl);

  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [history, setHistory] = useState<HistoryRecord[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const [note, setNote] = useState('');
  const [assignmentsText, setAssignmentsText] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setConnectionError(null);

    try {
      const [statsResponse, historyResponse] = await Promise.all([
        fetchJson<StatsResponse>(`${labUrl}/api/stats`),
        fetchJson<{ records: HistoryRecord[] }>(`${labUrl}/api/history?limit=10`),
      ]);

      setStats(statsResponse);
      setHistory(historyResponse.records);
    } catch {
      setStats(null);
      setHistory(null);
      setConnectionError(`Не удалось подключиться к Lab по адресу ${labUrl}. Убедитесь, что запущено «lab serve» в той же сети.`);
    } finally {
      setIsLoading(false);
    }
  }, [labUrl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSaveUrl = () => {
    const trimmed = urlDraft.trim().replace(/\/+$/, '');
    if (trimmed) setLabUrl(trimmed);
  };

  const handleSubmitMeasurement = async () => {
    setSubmitError(null);

    let metrics: Record<string, number>;
    try {
      metrics = parseAssignments(assignmentsText);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Не удалось разобрать метрики');
      return;
    }

    if (Object.keys(metrics).length === 0) {
      setSubmitError('Введите хотя бы одну метрику: ключ=значение');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`${labUrl}/api/measure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note, metrics }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${response.status}`);
      }

      setNote('');
      setAssignmentsText('');
      await refresh();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : `Не удалось отправить замер на ${labUrl}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const summaryRows = stats ? Object.entries(stats.summary).sort(([a], [b]) => a.localeCompare(b)) : [];

  return (
    <div className={styles.page}>
      <PageHeader
        title="Lab"
        description="CAD, расчёты и BOM для хардварных проектов. Backend — отдельный Python-проект (lab serve); эта страница — интерфейс к нему."
      />

      <Card view="outlined" className={styles.card}>
        <Text variant="subheader-2">Подключение</Text>
        <div className={styles.urlRow}>
          <TextInput
            value={urlDraft}
            onUpdate={setUrlDraft}
            placeholder={DEFAULT_LAB_URL}
            controlProps={{ 'aria-label': 'Адрес Lab API' }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleSaveUrl();
            }}
          />
          <Button view="outlined" onClick={handleSaveUrl} disabled={urlDraft.trim() === labUrl}>
            Сохранить
          </Button>
          <Button view="flat" onClick={() => void refresh()} loading={isLoading}>
            Обновить
          </Button>
        </div>
        <Text variant="caption-2" color="secondary">
          Адрес печатает сама команда — «lab serve &lt;project_dir&gt;» на машине, где физически идёт испытание.
          Сохраняется только в этом браузере.
        </Text>
        {connectionError && <Alert theme="warning" message={connectionError} />}
      </Card>

      {isLoading && !stats && !connectionError && <Loader size="m" />}

      {stats && (
        <Card view="outlined" className={styles.card}>
          <Text variant="subheader-2">
            {stats.project} — расчёт vs факт
          </Text>
          {summaryRows.length === 0 ? (
            <Text variant="body-2" color="secondary">
              История пуста — сначала «lab run» на стороне Lab.
            </Text>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Метрика</th>
                  <th>Расчёт</th>
                  <th>Факт</th>
                  <th>Разница</th>
                </tr>
              </thead>
              <tbody>
                {summaryRows.map(([key, row]) => (
                  <tr key={key}>
                    <td className={styles.metricName}>{key}</td>
                    <td>{formatNumber(row.latest_predicted)}</td>
                    <td>{formatNumber(row.latest_measured)}</td>
                    <td className={row.diff_pct !== null ? styles.diffCell : undefined}>
                      {row.diff_pct !== null ? `${row.diff_pct > 0 ? '+' : ''}${row.diff_pct}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      <Card view="outlined" className={styles.card}>
        <Text variant="subheader-2">Записать замер</Text>
        <TextInput value={note} onUpdate={setNote} placeholder="Заметка — заезд 3, озеро, ветер слабый" controlProps={{ 'aria-label': 'Заметка' }} />
        <TextArea
          value={assignmentsText}
          onUpdate={setAssignmentsText}
          placeholder={'total_mass_kg=0.95\nhydrostatics.waterline_transom_mm=24'}
          rows={4}
          controlProps={{ 'aria-label': 'Метрики' }}
        />
        <Text variant="caption-2" color="secondary">
          По одной метрике на строку: ключ=значение.
        </Text>
        {submitError && <Alert theme="danger" message={submitError} onClose={() => setSubmitError(null)} />}
        <Button view="action" onClick={() => void handleSubmitMeasurement()} loading={isSubmitting}>
          Записать
        </Button>
      </Card>

      {history && history.length > 0 && (
        <Card view="outlined" className={styles.card}>
          <Text variant="subheader-2">Последние записи</Text>
          <ul className={styles.historyList}>
            {history.map((record) => (
              <li key={record.timestamp} className={styles.historyItem}>
                <Text variant="caption-2" color="secondary">
                  {formatTimestamp(record.timestamp)} · {record.kind === 'measured' ? 'факт' : 'расчёт'}
                  {record.note ? ` · ${record.note}` : ''}
                </Text>
                <Text variant="caption-1" className={styles.historyMetrics}>
                  {Object.entries(record.metrics)
                    .map(([key, value]) => `${key}=${formatNumber(value)}`)
                    .join(', ')}
                </Text>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Text variant="caption-2" color="hint">
        Подробности: <code className={styles.path}>Lab/README.md</code> и{' '}
        <code className={styles.path}>Lab/IMPLEMENTATION_PLAN.md</code> в репозитории.
      </Text>
    </div>
  );
}
