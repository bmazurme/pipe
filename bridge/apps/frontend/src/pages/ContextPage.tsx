import { useState } from 'react';
import { ArrowDownToLine, BookOpen, Copy, Pencil, Plus, TrashBin } from '@gravity-ui/icons';
import { Alert, Button, Icon, Loader, Text } from '@gravity-ui/uikit';
import { Dialog } from '../shared/ui/Dialog';

import { formatRelativeTime } from '../shared/lib/formatRelativeTime';
import { triggerBlobDownload } from '../shared/lib/parcelCrypto';
import { ContextSummary, getErrorMessage, useDeleteContextMutation, useLazyGetContextQuery, useListContextsQuery } from '../store/api';
import { EmptyState } from '../widgets/EmptyState';
import { PageHeader } from '../widgets/PageHeader';
import { ContextDialog } from './context/ContextDialog';
import { contextFilename } from './context/contextExport';
import styles from './ContextPage.module.css';

// Improve schedules detach a deleted context; Lab ones keep pointing at it, so the dialog names them apart.
function schedulesOfKind(context: ContextSummary, kind: ContextSummary['schedules'][number]['kind']): string[] {
  return context.schedules.filter((schedule) => schedule.kind === kind).map((schedule) => schedule.name);
}

export function ContextPage() {
  const { data: contexts, isLoading, isError } = useListContextsQuery();
  const [deleteContext, { isLoading: isDeleting }] = useDeleteContextMutation();
  // `undefined` = dialog closed; `null` = creating; otherwise editing that context, or creating a copy of it.
  const [editing, setEditing] = useState<{ mode: 'edit' | 'copy'; id: number } | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<ContextSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [fetchContext] = useLazyGetContextQuery();
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [downloadFailed, setDownloadFailed] = useState(false);

  const handleDownload = async (context: ContextSummary) => {
    setDownloadingId(context.id);
    setDownloadFailed(false);

    try {
      const saved = await fetchContext(context.id).unwrap();

      triggerBlobDownload(new Blob([saved.content], { type: 'text/markdown' }), contextFilename(saved.name, saved.id));
    } catch {
      setDownloadFailed(true);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;

    try {
      await deleteContext(deleting.id).unwrap();
      setDeleting(null);
      setDeleteError(null);
    } catch (err) {
      setDeleteError(typeof err === 'string' ? err : getErrorMessage(err, 'Не удалось удалить контекст'));
    }
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title="Context"
        description="Сохранённый контекст для задач Worker: правила и заметки о проекте. По умолчанию задача идёт без контекста — его прикрепляют при запуске, вместе с итогами прошлых запусков или отдельно от них."
        actions={
          <Button view="action" size="m" onClick={() => setEditing(null)}>
            <Icon data={Plus} size={16} />
            Новый контекст
          </Button>
        }
      />

      {isError && <Alert theme="danger" view="filled" message="Не удалось загрузить контексты" />}

      {downloadFailed && <Alert theme="danger" view="filled" message="Не удалось скачать контекст" />}

      {isLoading && (
        <div className={styles.centered}>
          <Loader size="m" />
        </div>
      )}

      {contexts && contexts.length === 0 && (
        <EmptyState
          icon={BookOpen}
          title="Контекстов пока нет"
          description="Создайте контекст, а затем выберите его в форме «Новая задача» на странице Worker."
        />
      )}

      {contexts && contexts.length > 0 && (
        <ul className={styles.list}>
          {contexts.map((context) => (
            <li key={context.id} className={styles.row}>
              <div className={styles.rowMain}>
                <Text variant="body-2">{context.name}</Text>
                <Text variant="caption-2" color="secondary">
                  {context.contentLength !== null ? `${context.contentLength} симв. · ` : ''}обновлён {formatRelativeTime(context.updatedAt)} · в расписаниях: {context.schedules.length} ·{' '}
                  {context.lastUsedAt ? `запускался ${formatRelativeTime(context.lastUsedAt)}` : 'не использовался'}
                </Text>
              </div>
              <div className={styles.rowActions}>
                <Button view="flat-secondary" size="s" aria-label={`Изменить: ${context.name}`} onClick={() => setEditing({ mode: 'edit', id: context.id })}>
                  <Icon data={Pencil} size={16} />
                </Button>
                <Button view="flat-secondary" size="s" aria-label={`Дублировать: ${context.name}`} onClick={() => setEditing({ mode: 'copy', id: context.id })}>
                  <Icon data={Copy} size={16} />
                </Button>
                <Button
                  view="flat-secondary"
                  size="s"
                  aria-label={`Скачать: ${context.name}`}
                  loading={downloadingId === context.id}
                  onClick={() => void handleDownload(context)}
                >
                  <Icon data={ArrowDownToLine} size={16} />
                </Button>
                <Button
                  view="flat-danger"
                  size="s"
                  aria-label={`Удалить: ${context.name}`}
                  onClick={() => {
                    setDeleteError(null);
                    setDeleting(context);
                  }}
                >
                  <Icon data={TrashBin} size={16} />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing !== undefined && (
        <ContextDialog
          contextId={editing?.mode === 'edit' ? editing.id : null}
          copyFromId={editing?.mode === 'copy' ? editing.id : undefined}
          onClose={() => setEditing(undefined)}
        />
      )}

      <Dialog open={deleting !== null} onClose={() => setDeleting(null)} maxWidth="s" aria-labelledby="delete-context-title">
        <Dialog.Header caption={`Удалить «${deleting?.name ?? ''}»?`} id="delete-context-title" />
        <Dialog.Body>
          Задачи, которые уже запущены или стоят в очереди с этим контекстом, не изменятся — у них своя копия.
          {deleting && schedulesOfKind(deleting, 'improve').length > 0 && (
            <div>Расписания Improve продолжат работу без контекста: {schedulesOfKind(deleting, 'improve').join(', ')}</div>
          )}
          {deleting && schedulesOfKind(deleting, 'lab').length > 0 && (
            <div>Расписания Lab используют этот контекст — выберите им другой: {schedulesOfKind(deleting, 'lab').join(', ')}</div>
          )}
          {deleteError && <Alert theme="danger" view="filled" message={deleteError} />}
        </Dialog.Body>
        <Dialog.Footer
          textButtonCancel="Отмена"
          textButtonApply="Удалить"
          propsButtonApply={{ view: 'outlined-danger', loading: isDeleting }}
          onClickButtonCancel={() => setDeleting(null)}
          onClickButtonApply={() => void handleDelete()}
        />
      </Dialog>
    </div>
  );
}
