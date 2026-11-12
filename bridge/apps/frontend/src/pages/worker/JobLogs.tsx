import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowDownToLine, Copy } from '@gravity-ui/icons';
import { Button, Icon, Loader, SegmentedRadioGroup, Text, TextInput } from '@gravity-ui/uikit';

import { plural } from '../../shared/lib/plural';
import { triggerBlobDownload } from '../../shared/lib/parcelCrypto';
import styles from '../WorkerPage.module.css';
import { filterLogLines } from './jobLogFilter';
import { logToMarkdown } from './logMarkdown';

// Loaded on first use: the markdown pipeline is large and most logs are read as plain text.
const MarkdownRenderer = lazy(() => import('@gravity-ui/aikit').then((module) => ({ default: module.MarkdownRenderer })));

type LogView = 'text' | 'markdown';

const VIEW_KEY = 'pipe.jobLogs.view';

// A per-viewer convenience: storage can be missing or throw (private window), the log then opens as text.
function loadView(): LogView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'markdown' ? 'markdown' : 'text';
  } catch {
    return 'text';
  }
}

function saveView(view: LogView) {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Not remembered — fine.
  }
}

// How far from the end still counts as "reading the tail" — a few pixels of slack so a fractional scrollTop does not unpin.
const PIN_SLACK_PX = 24;

interface JobLogsProps {
  jobId: number;
  logs: string;
  // The job is still moving: the log keeps growing and is followed while the reader is at its end.
  active: boolean;
}

// The job's log: follows the tail while the reader is at the bottom, and stops following the moment they scroll up to
// read something (a terminal's behavior) — with a button to jump back down instead of being yanked there on every poll.
// A filter narrows the box to the lines containing a typed text; copy and download always take the full log.
export function JobLogs({ jobId, logs, active }: JobLogsProps) {
  const ref = useRef<HTMLPreElement & HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null);
  const [view, setView] = useState<LogView>(loadView);
  const [filter, setFilter] = useState('');

  const { text: shown, matched, total: lines } = filterLogLines(logs, filter);
  const filtering = filter.trim() !== '';

  const nothingMatches = filtering && matched === 0;
  // The filter narrows the lines first; the markdown view then formats what is left.
  const rendered = view === 'markdown' && shown && !nothingMatches ? logToMarkdown(shown) : null;

  useEffect(() => {
    const element = ref.current;

    if (element && active && pinnedRef.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [shown.length, active, view]);

  const handleScroll = () => {
    const element = ref.current;
    if (!element) return;

    const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight <= PIN_SLACK_PX;

    pinnedRef.current = atEnd;
    setPinned(atEnd);
  };

  const jumpToEnd = () => {
    const element = ref.current;
    if (!element) return;

    element.scrollTop = element.scrollHeight;
    pinnedRef.current = true;
    setPinned(true);
  };

  const handleView = (value: string) => {
    const next: LogView = value === 'markdown' ? 'markdown' : 'text';

    setView(next);
    saveView(next);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(logs);
      setCopied('ok');
    } catch {
      setCopied('failed');
    }
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <section aria-label="Логи" className={styles.logsSection}>
      <div className={styles.logsHeader}>
        <Text variant="subheader-1" className={styles.logsTitle}>
          Логи
          {lines > 0 && (
            <Text color="secondary" variant="body-1">
              {' '}
              ·{' '}
              {filtering
                ? `${matched} из ${lines} ${plural(lines, ['строки', 'строк', 'строк'])}`
                : `${lines} ${plural(lines, ['строка', 'строки', 'строк'])}`}
            </Text>
          )}
        </Text>
        {logs && (
          <div className={styles.logsActions}>
            <SegmentedRadioGroup size="s" value={view} onUpdate={handleView} aria-label="Вид лога">
              <SegmentedRadioGroup.Option value="text">Текст</SegmentedRadioGroup.Option>
              <SegmentedRadioGroup.Option value="markdown">Markdown</SegmentedRadioGroup.Option>
            </SegmentedRadioGroup>
            <TextInput
              className={styles.logsFilter}
              size="s"
              placeholder="Фильтр"
              value={filter}
              onUpdate={setFilter}
              controlProps={{ 'aria-label': 'Фильтр строк лога' }}
              // TextInput's own onKeyDown, not controlProps.onKeyDown: the control overrides the latter with the former.
              onKeyDown={(event) => {
                if (event.key === 'Escape' && filter) {
                  // Escape here clears the filter instead of closing the dialog the log sits in.
                  event.stopPropagation();
                  setFilter('');
                }
              }}
            />
            {filter && (
              <Button view="flat-secondary" size="s" onClick={() => setFilter('')}>
                Сбросить
              </Button>
            )}
            <Button view="flat-secondary" size="s" onClick={() => void handleCopy()}>
              <Icon data={Copy} size={14} />
              {copied === 'ok' ? 'Скопировано' : copied === 'failed' ? 'Не удалось скопировать' : 'Копировать'}
            </Button>
            <Button
              view="flat-secondary"
              size="s"
              onClick={() => triggerBlobDownload(new Blob([logs], { type: 'text/plain;charset=utf-8' }), `job-${jobId}.log`)}
            >
              <Icon data={ArrowDownToLine} size={14} />
              Скачать .log
            </Button>
          </div>
        )}
      </div>
      <div className={styles.logsWrap}>
        {rendered ? (
          <div
            ref={ref}
            className={`${styles.logs} ${styles.logsMarkdown}`}
            onScroll={handleScroll}
            tabIndex={0}
            role="region"
            aria-label="Лог задачи"
          >
            {rendered.truncated && (
              <Text color="secondary" variant="body-1" as="div">
                Показан конец лога — весь текст в режиме «Текст» и в .log.
              </Text>
            )}
            <Suspense fallback={<Loader size="s" />}>
              <MarkdownRenderer content={rendered.markdown} openLinksInNewTab />
            </Suspense>
          </div>
        ) : (
          <pre
            ref={ref}
            className={styles.logs}
            onScroll={handleScroll}
            tabIndex={0}
            role="region"
            aria-label="Лог задачи"
          >
            {nothingMatches ? `Нет строк с «${filter.trim()}»` : shown || '(пока пусто)'}
          </pre>
        )}
        {active && !pinned && (
          <Button className={styles.logsJump} view="raised" size="s" onClick={jumpToEnd}>
            <Icon data={ArrowDown} size={14} />К концу
          </Button>
        )}
      </div>
    </section>
  );
}
