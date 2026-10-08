import { useState } from 'react';
import { Alert, Dialog, Text, TextArea, TextInput } from '@gravity-ui/uikit';

import {
  getErrorMessage,
  MAX_CONTEXT_LENGTH,
  MAX_CONTEXT_NAME_LENGTH,
  SavedContext,
  useCreateContextMutation,
  useUpdateContextMutation,
} from '../../store/api';
import styles from '../ContextPage.module.css';

interface ContextDialogProps {
  /** The context being edited, or null to create a new one. */
  context: SavedContext | null;
  onClose: () => void;
}

export function ContextDialog({ context, onClose }: ContextDialogProps) {
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
