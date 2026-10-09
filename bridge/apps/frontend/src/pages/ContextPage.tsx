import { useState } from 'react';
import { BookOpen, Pencil, Plus, TrashBin } from '@gravity-ui/icons';
import { Alert, Button, Dialog, Icon, Loader, Text } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../shared/lib/formatRelativeTime';
import { ContextSummary, getErrorMessage, useDeleteContextMutation, useListContextsQuery } from '../store/api';
import { EmptyState } from '../widgets/EmptyState';
import { PageHeader } from '../widgets/PageHeader';
import { ContextDialog } from './context/ContextDialog';
import styles from './ContextPage.module.css';

export function ContextPage() {
  const { data: contexts, isLoading, isError } = useListContextsQuery();
  const [deleteContext, { isLoading: isDeleting }] = useDeleteContextMutation();
  // `undefined` = dialog closed; `null` = creating; an id = editing that context.
  const [editing, setEditing] = useState<number | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<ContextSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
                  {context.contentLength !== null ? `${context.contentLength} симв. · ` : ''}обновлён {formatRelativeTime(context.updatedAt)}
                </Text>
              </div>
              <div className={styles.rowActions}>
                <Button view="flat-secondary" size="s" aria-label={`Изменить: ${context.name}`} onClick={() => setEditing(context.id)}>
                  <Icon data={Pencil} size={16} />
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

      {editing !== undefined && <ContextDialog contextId={editing} onClose={() => setEditing(undefined)} />}

      <Dialog open={deleting !== null} onClose={() => setDeleting(null)} maxWidth="s" aria-labelledby="delete-context-title">
        <Dialog.Header caption={`Удалить «${deleting?.name ?? ''}»?`} id="delete-context-title" />
        <Dialog.Body>
          Задачи, которые уже запущены или стоят в очереди с этим контекстом, не изменятся — у них своя копия.
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
