import { useState } from 'react';
import { Alert, Dialog, Text, TextArea, TextInput } from '@gravity-ui/uikit';
import { Link } from 'react-router-dom';

import { getErrorMessage, MAX_CONTEXT_LENGTH, MAX_CONTEXT_NAME_LENGTH, useCreateContextMutation } from '../../store/api';
import styles from '../ChatPage.module.css';
import type { ContextDraft } from './chatContext';

interface SaveToContextDialogProps {
  draft: ContextDraft;
  onClose: () => void;
}

// A chat as a saved Context, which can then be attached to a Worker job. Prefilled, and every
// part editable first — a conversation usually has some turns the next task does not need.
export function SaveToContextDialog({ draft, onClose }: SaveToContextDialogProps) {
  const [createContext, { isLoading }] = useCreateContextMutation();
  const [name, setName] = useState(draft.name);
  const [content, setContent] = useState(draft.content);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return setError('Укажите название');
    if (!content.trim()) return setError('Контекст не может быть пустым');
    if (content.length > MAX_CONTEXT_LENGTH) return setError(`Текст длиннее ${MAX_CONTEXT_LENGTH} символов — сократите его`);

    setError(null);

    try {
      await createContext({ name: name.trim(), content }).unwrap();
      setSaved(true);
    } catch (err) {
      setError(typeof err === 'string' && err ? err : getErrorMessage(err, 'Не удалось сохранить контекст'));
    }
  };

  if (saved) {
    return (
      <Dialog open onClose={onClose} maxWidth="s" aria-labelledby="save-context-title">
        <Dialog.Header caption="Сохранено в Context" id="save-context-title" />
        <Dialog.Body>
          <Text>
            Контекст «{name.trim()}» сохранён. Выберите его в форме «Новая задача» на странице Worker, чтобы прикрепить к задаче.{' '}
            <Link to="/context">Открыть Context</Link>
          </Text>
        </Dialog.Body>
        <Dialog.Footer textButtonApply="Готово" onClickButtonApply={onClose} />
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} maxWidth="m" aria-labelledby="save-context-title">
      <Dialog.Header caption="Сохранить чат в Context" id="save-context-title" />
      <Dialog.Body>
        <div className={styles.contextForm}>
          <Text variant="body-1" color="secondary">
            Диалог ({draft.messages} сообщ.) сохранится как текст контекста. Можно отредактировать его перед сохранением.
          </Text>
          {draft.truncated && <Alert theme="warning" view="filled" message="Диалог длиннее лимита контекста — сохранён его конец, начало опущено." />}
          <TextInput label="Название" value={name} onUpdate={setName} controlProps={{ 'aria-label': 'Название контекста', maxLength: MAX_CONTEXT_NAME_LENGTH }} />
          <TextArea value={content} onUpdate={setContent} minRows={8} maxRows={16} controlProps={{ 'aria-label': 'Текст контекста' }} />
          <Text variant="caption-2" color={content.length > MAX_CONTEXT_LENGTH ? 'danger' : 'secondary'} className={styles.counter}>
            {content.length} / {MAX_CONTEXT_LENGTH}
          </Text>
          {error && <Alert theme="danger" view="filled" message={error} />}
        </div>
      </Dialog.Body>
      <Dialog.Footer
        textButtonCancel="Отмена"
        textButtonApply="Сохранить"
        propsButtonApply={{ loading: isLoading }}
        onClickButtonCancel={onClose}
        onClickButtonApply={() => void handleSave()}
      />
    </Dialog>
  );
}
