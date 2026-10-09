import { useState } from 'react';
import { Alert, Dialog, Loader, Text, TextArea, TextInput } from '@gravity-ui/uikit';

import {
  getErrorMessage,
  MAX_CONTEXT_LENGTH,
  MAX_CONTEXT_NAME_LENGTH,
  SavedContext,
  useCreateContextMutation,
  useGetContextQuery,
  useUpdateContextMutation,
} from '../../store/api';
import styles from '../ContextPage.module.css';

interface ContextDialogProps {
  /** The context being edited, or null to create a new one. */
  contextId: number | null;
  onClose: () => void;
}

// The list only carries summaries, so an existing context's text is fetched when it is
// opened; the form itself mounts once that has arrived, so it starts from the real text.
export function ContextDialog({ contextId, onClose }: ContextDialogProps) {
  const { data: context, isLoading, isError } = useGetContextQuery(contextId ?? 0, { skip: contextId === null });

  if (contextId === null) return <ContextForm context={null} onClose={onClose} />;

  if (context) return <ContextForm key={context.id} context={context} onClose={onClose} />;

  return (
    <Dialog open onClose={onClose} maxWidth="m" aria-labelledby="context-dialog-title">
      <Dialog.Header caption="Изменить контекст" id="context-dialog-title" />
      <Dialog.Body>
        {isLoading && <Loader size="m" />}
        {isError && <Alert theme="danger" view="filled" message="Не удалось загрузить контекст" />}
      </Dialog.Body>
      <Dialog.Footer textButtonApply="Закрыть" onClickButtonApply={onClose} />
    </Dialog>
  );
}

function ContextForm({ context, onClose }: { context: SavedContext | null; onClose: () => void }) {
  const [createContext, { isLoading: isCreating }] = useCreateContextMutation();
  const [updateContext, { isLoading: isUpdating }] = useUpdateContextMutation();
  const [name, setName] = useState(context?.name ?? '');
  const [content, setContent] = useState(context?.content ?? '');
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim()) return setError('Укажите название');
    if (!content.trim()) return setError('Контекст не может быть пустым');

    setError(null);

    try {
      if (context) await updateContext({ id: context.id, name: name.trim(), content }).unwrap();
      else await createContext({ name: name.trim(), content }).unwrap();
      onClose();
    } catch (err) {
      // The endpoints' transformErrorResponse already reduced the error to a message.
      setError(typeof err === 'string' && err ? err : getErrorMessage(err, 'Не удалось сохранить контекст'));
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="m" aria-labelledby="context-dialog-title">
      <Dialog.Header caption={context ? 'Изменить контекст' : 'Новый контекст'} id="context-dialog-title" />
      <Dialog.Body>
        <div className={styles.form}>
          <TextInput
            label="Название"
            value={name}
            onUpdate={setName}
            controlProps={{ 'aria-label': 'Название контекста', maxLength: MAX_CONTEXT_NAME_LENGTH }}
            autoFocus
          />
          <TextArea
            value={content}
            onUpdate={setContent}
            minRows={8}
            maxRows={16}
            placeholder="Что модели нужно знать о проекте: договорённости, ограничения, структура, заметки с прошлых запусков…"
            controlProps={{ 'aria-label': 'Текст контекста', maxLength: MAX_CONTEXT_LENGTH }}
          />
          <Text variant="caption-2" color="secondary" className={styles.counter}>
            {content.length} / {MAX_CONTEXT_LENGTH}
          </Text>
          {error && <Alert theme="danger" view="filled" message={error} />}
        </div>
      </Dialog.Body>
      <Dialog.Footer
        textButtonCancel="Отмена"
        textButtonApply="Сохранить"
        propsButtonApply={{ loading: isCreating || isUpdating }}
        onClickButtonCancel={onClose}
        onClickButtonApply={() => void handleSave()}
      />
    </Dialog>
  );
}
