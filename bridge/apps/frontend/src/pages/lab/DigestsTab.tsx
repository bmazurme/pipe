import { useEffect, useMemo, useState } from 'react';
import { FileText } from '@gravity-ui/icons';
import { scanForLeaks } from '@pipe/protocol/leakScan';
import { Alert, Button, Card, Label, Select, Skeleton, Switch, Text, TextArea, TextInput } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import {
  getErrorMessage,
  type LabDigest,
  type LabDigestItem,
  useDeleteLabDigestMutation,
  useGetLabDigestSettingsQuery,
  useListLabDigestsQuery,
  useMarkLabDigestExportedMutation,
  usePreviewLabDigestQuery,
  useSaveLabDigestSettingsMutation,
  useStartLabDigestMutation,
  useUpdateLabDigestMutation,
} from '../../store/api';
import { EmptyState } from '../../widgets/EmptyState';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../ImprovePage.module.css';
import { useModelOptions } from '../worker/useModelOptions';
import {
  DIGEST_STATUS_LABEL,
  DIGEST_STATUS_THEME,
  digestFileName,
  digestMarkdownFile,
  isIgnoredLeak,
  parseTags,
  recentWeeks,
  SOURCE_LABEL,
  weekLabel,
} from './digestUtils';

const POLL_MS = 5000;
const WEEKS_SHOWN = 8;
const NOTES_URL = 'https://notes.ntlstl.dev/';

function ItemList({ items }: { items: LabDigestItem[] }) {
  return (
    <ul>
      {items.map((item) => (
        <li key={`${item.source}-${item.id}`}>
          <Text variant="caption-2">
            [{SOURCE_LABEL[item.source]}] {item.title}
            {item.repo ? ` · ${item.repo}` : ''}
            {item.url ? (
              <>
                {' · '}
                <a href={item.url} target="_blank" rel="noreferrer">
                  ссылка
                </a>
              </>
            ) : null}
          </Text>
        </li>
      ))}
    </ul>
  );
}

// Settings that decide what a digest is made of and whether it is made by itself.
function SettingsCard() {
  const { data, isLoading } = useGetLabDigestSettingsQuery();
  const [save, { isLoading: isSaving }] = useSaveLabDigestSettingsMutation();
  const { options } = useModelOptions();
  const [error, setError] = useState<string | null>(null);

  const change = async (patch: Parameters<typeof save>[0]) => {
    setError(null);

    try {
      await save(patch).unwrap();
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось сохранить настройки'));
    }
  };

  if (isLoading || !data) return <Skeleton height={120} />;

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader title="Как собирать" />
      <Switch checked={data.autoWeekly} disabled={isSaving} onUpdate={(autoWeekly) => void change({ autoWeekly })} content="Собирать черновик сам — в понедельник с 06:00 (МСК), за прошедшую неделю" />
      <Switch checked={data.includePrivate} disabled={isSaving} onUpdate={(includePrivate) => void change({ includePrivate })} content="Включать приватные репозитории и посылки (GitLab)" />
      <Text color="secondary" variant="caption-2">
        По умолчанию в дайджест попадает только работа в публичных репозиториях GitHub: заметки на notes.ntlstl.dev публичны. Посылки из sync и reports — работа в GitLab, они считаются приватными. Если GitHub не ответил, репозиторий
        тоже считается приватным.
      </Text>
      <Select size="m" label="Модель:" value={[data.model]} onUpdate={([model]) => model && void change({ model })} options={options} width={280} />
      {error && <Alert theme="danger" view="filled" message={error} />}
    </Card>
  );
}

// Pick a week, see what would go in, make the digest.
function MakeCard({ onStarted }: { onStarted: (digest: LabDigest) => void }) {
  const weeks = useMemo(() => recentWeeks(new Date(), WEEKS_SHOWN), []);
  const [week, setWeek] = useState(weeks[1] ?? weeks[0]);
  const { data: preview, isFetching, isError } = usePreviewLabDigestQuery({ weekStart: week });
  const [start, { isLoading: isStarting }] = useStartLabDigestMutation();
  const [error, setError] = useState<string | null>(null);

  const handleStart = async () => {
    setError(null);

    try {
      onStarted(await start({ weekStart: week }).unwrap());
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось собрать дайджест'));
    }
  };

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader title="Собрать дайджест недели" />
      <div className={styles.toolbar}>
        <Select
          size="m"
          label="Неделя:"
          value={[week]}
          onUpdate={([value]) => value && setWeek(value)}
          options={weeks.map((value, index) => ({ value, content: `${weekLabel(value)}${index === 0 ? ' (идёт)' : ''}` }))}
          width={300}
        />
        <Button view="action" loading={isStarting} disabled={isFetching || !preview || preview.items.length === 0} onClick={() => void handleStart()}>
          Собрать
        </Button>
      </div>

      {isFetching && <Skeleton height={40} />}
      {isError && <Alert theme="danger" view="outlined" message="Не удалось получить список работ недели" />}
      {!isFetching && preview && (
        <>
          <Text variant="body-2">
            Завершённых работ в дайджесте: {preview.items.length}
            {preview.omitted > 0 ? ` (ещё ${preview.omitted} не поместились)` : ''}
            {preview.excludedPrivate > 0 ? ` · скрыто приватных: ${preview.excludedPrivate}` : ''}
          </Text>
          {preview.items.length > 0 && (
            <details>
              <summary>Что войдёт</summary>
              <ItemList items={preview.items} />
            </details>
          )}
          {preview.items.length === 0 && (
            <Text color="secondary" variant="caption-2">
              {preview.excludedPrivate > 0 ? 'В публичных репозиториях работы нет — включите приватные в настройках выше, если это ваши заметки.' : 'За эту неделю нет завершённых работ с результатом (PR, issue, анализ, посылка).'}
            </Text>
          )}
        </>
      )}
      {error && <Alert theme="danger" view="filled" message={error} />}
    </Card>
  );
}

// A draft the owner reads, corrects and carries to notes.ntlstl.dev.
function DigestEditor({ digest }: { digest: LabDigest }) {
  const [update, { isLoading: isSaving }] = useUpdateLabDigestMutation();
  const [markExported, { isLoading: isMarking }] = useMarkLabDigestExportedMutation();
  const [start, { isLoading: isRestarting }] = useStartLabDigestMutation();
  const [remove, { isLoading: isRemoving }] = useDeleteLabDigestMutation();
  const [title, setTitle] = useState(digest.title ?? '');
  const [preview, setPreview] = useState(digest.preview ?? '');
  const [tags, setTags] = useState(digest.tags.join(', '));
  const [content, setContent] = useState(digest.content ?? '');
  const [message, setMessage] = useState<{ theme: 'success' | 'danger'; text: string } | null>(null);
  const [confirm, setConfirm] = useState<'restart' | 'delete' | null>(null);

  const dirty = title !== (digest.title ?? '') || preview !== (digest.preview ?? '') || content !== (digest.content ?? '') || parseTags(tags).join(',') !== digest.tags.join(',');
  const leaks = useMemo(
    () => scanForLeaks([{ source: 'заметка', content: `${title}\n${preview}\n${content}` }]).filter((finding) => !(finding.kind === 'hostname' && isIgnoredLeak(finding.match))),
    [title, preview, content],
  );

  const run = async (action: () => Promise<unknown>, done: string, fallback: string) => {
    setMessage(null);

    try {
      await action();
      setMessage({ theme: 'success', text: done });
    } catch (err) {
      setMessage({ theme: 'danger', text: getErrorMessage(err, fallback) });
    }
  };

  const handleSave = () => run(() => update({ id: digest.id, edit: { title, preview, content, tags: parseTags(tags) } }).unwrap(), 'Сохранено', 'Не удалось сохранить');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setMessage({ theme: 'success', text: 'Текст скопирован' });
    } catch {
      setMessage({ theme: 'danger', text: 'Не удалось скопировать — выделите текст вручную' });
    }
  };

  const handleDownload = () => {
    const blob = new Blob([digestMarkdownFile({ title, preview, content, tags: parseTags(tags), noteType: digest.noteType })], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = digestFileName(digest.weekStart);
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader title={`Заметка: ${weekLabel(digest.weekStart)}`} />
      <Text color="secondary" variant="caption-2">
        Тип на сайте: «{digest.noteType}». Черновик хранится только в bridge — на notes.ntlstl.dev он не попадает, пока вы не перенесёте его сами.
      </Text>

      <TextInput value={title} onUpdate={setTitle} label="Заголовок" controlProps={{ 'aria-label': 'Заголовок', maxLength: 100 }} />
      <TextArea value={preview} onUpdate={setPreview} rows={2} maxRows={6} placeholder="Краткое описание" controlProps={{ 'aria-label': 'Краткое описание' }} />
      <TextInput value={tags} onUpdate={setTags} label="Теги" placeholder="через запятую" controlProps={{ 'aria-label': 'Теги' }} />
      <TextArea value={content} onUpdate={setContent} rows={16} maxRows={40} controlProps={{ 'aria-label': 'Текст заметки' }} />

      {leaks.length > 0 && (
        <Alert
          theme="warning"
          view="outlined"
          title="Похоже на реальные данные — проверьте перед публикацией"
          message={
            <ul>
              {leaks.slice(0, 8).map((finding, index) => (
                <li key={index}>
                  строка {finding.line}: {finding.kind} — {finding.match}
                </li>
              ))}
              {leaks.length > 8 && <li>…и ещё {leaks.length - 8}</li>}
            </ul>
          }
        />
      )}

      <div className={styles.toolbar}>
        <Button view="action" loading={isSaving} disabled={!dirty || title.trim().length < 2 || content.trim().length === 0} onClick={() => void handleSave()}>
          Сохранить
        </Button>
        <Button view="normal" onClick={() => void handleCopy()}>
          Скопировать текст
        </Button>
        <Button view="normal" onClick={handleDownload}>
          Скачать .md
        </Button>
        <Button view="outlined" loading={isMarking} disabled={dirty || digest.status === 'exported'} onClick={() => void run(() => markExported(digest.id).unwrap(), 'Отмечено', 'Не удалось отметить')}>
          {digest.status === 'exported' ? 'Уже перенесено' : 'Перенёс в notes'}
        </Button>
        <a href={NOTES_URL} target="_blank" rel="noreferrer">
          notes.ntlstl.dev
        </a>
      </div>
      {dirty && (
        <Text color="secondary" variant="caption-2">
          Есть несохранённые правки.
        </Text>
      )}

      <details>
        <summary>Источники: {digest.items.length}</summary>
        <ItemList items={digest.items} />
        {digest.excludedPrivate > 0 && (
          <Text color="secondary" variant="caption-2">
            Скрыто приватных работ: {digest.excludedPrivate}
          </Text>
        )}
      </details>

      <div className={styles.toolbar}>
        {confirm === 'restart' ? (
          <>
            <Text>Собрать заново? Текущий текст и ваши правки будут заменены.</Text>
            <Button view="action" loading={isRestarting} onClick={() => void run(() => start({ weekStart: digest.weekStart }).unwrap(), 'Собирается заново', 'Не удалось собрать').then(() => setConfirm(null))}>
              Да, заново
            </Button>
            <Button view="flat" onClick={() => setConfirm(null)}>
              Нет
            </Button>
          </>
        ) : confirm === 'delete' ? (
          <>
            <Text>Удалить дайджест?</Text>
            <Button view="outlined-danger" loading={isRemoving} onClick={() => void run(() => remove(digest.id).unwrap(), 'Удалено', 'Не удалось удалить')}>
              Да, удалить
            </Button>
            <Button view="flat" onClick={() => setConfirm(null)}>
              Нет
            </Button>
          </>
        ) : (
          <>
            <Button view="flat" onClick={() => setConfirm('restart')}>
              Собрать заново
            </Button>
            <Button view="flat-danger" onClick={() => setConfirm('delete')}>
              Удалить
            </Button>
          </>
        )}
      </div>
      {message && <Alert theme={message.theme} view="outlined" message={message.text} />}
    </Card>
  );
}

function DigestFailure({ digest }: { digest: LabDigest }) {
  const [start, { isLoading }] = useStartLabDigestMutation();
  const [remove, { isLoading: isRemoving }] = useDeleteLabDigestMutation();
  const [error, setError] = useState<string | null>(null);

  const retry = async () => {
    setError(null);

    try {
      await start({ weekStart: digest.weekStart }).unwrap();
    } catch (err) {
      setError(getErrorMessage(err, 'Не удалось собрать'));
    }
  };

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader title={`Дайджест не собрался: ${weekLabel(digest.weekStart)}`} />
      <Alert theme="danger" view="outlined" message={digest.error ?? 'Неизвестная ошибка'} />
      <div className={styles.toolbar}>
        <Button view="action" loading={isLoading} onClick={() => void retry()}>
          Повторить
        </Button>
        <Button view="flat-danger" loading={isRemoving} onClick={() => void remove(digest.id)}>
          Удалить
        </Button>
      </div>
      {error && <Alert theme="danger" view="filled" message={error} />}
    </Card>
  );
}

// Lab, the weekly diary: what workers finished in a week (Lab, Improve, parcels from sync and reports) → one note for notes.ntlstl.dev.
// A worker writes the draft; nothing leaves bridge until the owner carries it over.
export function DigestsTab() {
  const [pollMs, setPollMs] = useState(0);
  const { data: digests = [], isLoading, isError } = useListLabDigestsQuery(undefined, { pollingInterval: pollMs });
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    setPollMs(digests.some((digest) => digest.status === 'generating') ? POLL_MS : 0);
  }, [digests]);

  const selected = digests.find((digest) => digest.id === selectedId) ?? digests.find((digest) => digest.status === 'draft') ?? null;

  return (
    <div className={styles.panel}>
      <SettingsCard />
      <MakeCard onStarted={(digest) => setSelectedId(digest.id)} />

      <SectionHeader title="Дайджесты" meta={digests.length > 0 ? String(digests.length) : undefined} />
      {isLoading && <Skeleton height={80} />}
      {isError && <Alert theme="danger" view="filled" message="Не удалось загрузить дайджесты" />}
      {!isLoading && !isError && digests.length === 0 && <EmptyState icon={FileText} title="Дайджестов пока нет" description="Выберите неделю выше и нажмите «Собрать»." />}

      {digests.map((digest) => (
        <div key={digest.id} className={styles.row}>
          <div className={styles.rowMain}>
            <Text variant="body-2">{weekLabel(digest.weekStart)}</Text>
            <Text color="secondary" variant="caption-2">
              {digest.title ?? 'без заголовка'} · работ: {digest.items.length} · {formatRelativeTime(digest.updatedAt)}
            </Text>
          </div>
          <Label theme={DIGEST_STATUS_THEME[digest.status]}>{DIGEST_STATUS_LABEL[digest.status]}</Label>
          {(digest.status === 'draft' || digest.status === 'exported' || digest.status === 'failed') && (
            <Button view="flat" size="s" onClick={() => setSelectedId(digest.id)}>
              Открыть
            </Button>
          )}
        </div>
      ))}

      {selected && (selected.status === 'draft' || selected.status === 'exported') && <DigestEditor key={`${selected.id}:${selected.updatedAt}`} digest={selected} />}
      {selected && selected.status === 'failed' && <DigestFailure digest={selected} />}
    </div>
  );
}
