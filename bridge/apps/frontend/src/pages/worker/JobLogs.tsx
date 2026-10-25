import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowDownToLine, Copy } from '@gravity-ui/icons';
import { Button, Icon, Text } from '@gravity-ui/uikit';

import { plural } from '../../shared/lib/plural';
import { triggerBlobDownload } from '../../shared/lib/parcelCrypto';
import styles from '../WorkerPage.module.css';

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
export function JobLogs({ jobId, logs, active }: JobLogsProps) {
  const ref = useRef<HTMLPreElement>(null);
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null);

  useEffect(() => {
    const element = ref.current;

    if (element && active && pinnedRef.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [logs.length, active]);

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

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(logs);
      setCopied('ok');
    } catch {
      setCopied('failed');
    }
    setTimeout(() => setCopied(null), 2000);
  };

  const lines = logs ? logs.replace(/\n$/, '').split('\n').length : 0;

  return (
    <section aria-label="Логи" className={styles.logsSection}>
      <div className={styles.logsHeader}>
        <Text variant="subheader-1" className={styles.logsTitle}>
          Логи
          {lines > 0 && (
            <Text color="secondary" variant="body-1">
              {' '}
              · {lines} {plural(lines, ['строка', 'строки', 'строк'])}
            </Text>
          )}
        </Text>
        {logs && (
          <div className={styles.logsActions}>
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
        <pre
          ref={ref}
          className={styles.logs}
          onScroll={handleScroll}
          tabIndex={0}
          role="region"
          aria-label="Лог задачи"
        >
          {logs || '(пока пусто)'}
        </pre>
        {active && !pinned && (
          <Button className={styles.logsJump} view="raised" size="s" onClick={jumpToEnd}>
            <Icon data={ArrowDown} size={14} />К концу
          </Button>
        )}
      </div>
    </section>
  );
}
