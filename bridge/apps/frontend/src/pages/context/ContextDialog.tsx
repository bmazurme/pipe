import { useDeferredValue, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { Alert, Button, Loader, Text, TextArea, TextInput } from '@gravity-ui/uikit';
import { Dialog } from '../../shared/ui/Dialog';
import { scanForLeaks } from '@pipe/protocol/leakScan';

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
import { isTextFile } from '../storage/textFiles';

interface ContextDialogProps {
  /** The context being edited, or null to create a new one. */
  contextId: number | null;
  /** Start a new context from a copy of this one instead; `contextId` is ignored then. */
  copyFromId?: number;
  onClose: () => void;
}

const COPY_SUFFIX = ' (копия)';

// The copy's name keeps the suffix, so the source name is what gets cut to the limit.
const copyName = (name: string) => name.slice(0, MAX_CONTEXT_NAME_LENGTH - COPY_SUFFIX.length) + COPY_SUFFIX;

// The list only carries summaries, so an existing context's text is fetched when it is
// opened; the form itself mounts once that has arrived, so it starts from the real text.
export function ContextDialog({ contextId, copyFromId, onClose }: ContextDialogProps) {
  const sourceId = copyFromId ?? contextId;
  const { data: context, isLoading, isError } = useGetContextQuery(sourceId ?? 0, { skip: sourceId === null });

  if (sourceId === null) return <ContextForm context={null} onClose={onClose} />;

  // A copy is a new context that starts from the source's text: saving creates, never updates the source.
  if (context && copyFromId !== undefined)
    return <ContextForm key={`copy-${context.id}`} context={null} initialName={copyName(context.name)} initialContent={context.content} onClose={onClose} />;

  if (context) return <ContextForm key={context.id} context={context} onClose={onClose} />;

  return (
    <Dialog open onClose={onClose} maxWidth="l" aria-labelledby="context-dialog-title">
      <Dialog.Header caption={copyFromId !== undefined ? 'Новый контекст' : 'Изменить контекст'} id="context-dialog-title" />
      <Dialog.Body>
        {isLoading && <Loader size="m" />}
        {isError && <Alert theme="danger" view="filled" message="Не удалось загрузить контекст" />}
      </Dialog.Body>
      <Dialog.Footer textButtonApply="Закрыть" onClickButtonApply={onClose} />
    </Dialog>
  );
}

interface ContextFormProps {
  context: SavedContext | null;
  /** Starting values for a new context (a copy); an existing context starts from its own. */
  initialName?: string;
  initialContent?: string;
  onClose: () => void;
}

function ContextForm({ context, initialName = context?.name ?? '', initialContent = context?.content ?? '', onClose }: ContextFormProps) {
  const [createContext, { isLoading: isCreating }] = useCreateContextMutation();
  const [updateContext, { isLoading: isUpdating }] = useUpdateContextMutation();
  const [name, setName] = useState(initialName);
  const [content, setContent] = useState(initialContent);
  const [error, setError] = useState<string | null>(null);

  const [notice, setNotice] = useState<string | null>(null);
  // Derived from the current text rather than stored on file load, so the warning follows edits.
  const deferredContent = useDeferredValue(content);
  const leaks = useMemo(() => scanForLeaks([{ source: 'контекст', content: deferredContent }]), [deferredContent]);
  const fileInput = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const isSaving = isCreating || isUpdating;
  // Anything typed or loaded that is not saved yet: closing then asks first, so a stray Escape does not throw it away.
  const isDirty = name !== initialName || content !== initialContent;
  const nearLimit = content.length > MAX_CONTEXT_LENGTH * 0.9;

  // The form can be taller than the window: bring a new error into view instead of leaving it below the fold.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [error]);

  const requestClose = () => {
    if (isDirty && !isSaving) setConfirmDiscard(true);
    else onClose();
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setNotice(null);

    if (!isTextFile(file.name)) {
      setError(`Файл «${file.name}» не текстовый — загрузите .md, .txt или другой текстовый файл`);
      return;
    }

    setError(null);
    const text = await file.text();
    const truncated = text.length > MAX_CONTEXT_LENGTH;
    const loaded = truncated ? text.slice(0, MAX_CONTEXT_LENGTH) : text;

    if (!name.trim()) setName(file.name.replace(/\.[^.]*$/, '').slice(0, MAX_CONTEXT_NAME_LENGTH));
    setContent(loaded);
    if (truncated) setNotice(`Файл обрезан до ${MAX_CONTEXT_LENGTH.toLocaleString('ru-RU')} символов`);
  };

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

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !isSaving) {
      event.preventDefault();
      void handleSave();
    }
  };

  return (
    <Dialog open onClose={requestClose} maxWidth="l" aria-labelledby="context-dialog-title">
      <Dialog.Header caption={context ? 'Изменить контекст' : 'Новый контекст'} id="context-dialog-title" />
      <Dialog.Body>
        <div className={styles.form} onKeyDown={handleKeyDown}>
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
            minRows={12}
            maxRows={24}
            autoFocus={context !== null}
            placeholder="Что модели нужно знать о проекте: договорённости, ограничения, структура, заметки с прошлых запусков…"
            controlProps={{ 'aria-label': 'Текст контекста', maxLength: MAX_CONTEXT_LENGTH }}
          />
          <input
            ref={fileInput}
            type="file"
            accept=".md,.mdx,.txt,.json,.yml,.yaml,.xml,.html,.css,.sql,.sh,.js,.ts"
            aria-label="Файл с текстом контекста"
            hidden
            onChange={(event) => void handleFile(event)}
          />
          <div className={styles.formToolbar}>
            <Button view="outlined" onClick={() => fileInput.current?.click()}>
              Загрузить из файла
            </Button>
            <Text variant="caption-2" color="secondary" className={styles.hint}>
              Ctrl/⌘ + Enter — сохранить
            </Text>
            <Text variant="caption-2" color={nearLimit ? 'warning' : 'secondary'} className={styles.counter}>
              {content.length.toLocaleString('ru-RU')} / {MAX_CONTEXT_LENGTH.toLocaleString('ru-RU')}
            </Text>
          </div>
          {notice && <Alert theme="warning" message={notice} />}
          {leaks.length > 0 && (
            <Alert
              theme="warning"
              title="В тексте найдено похожее на секреты — проверьте перед сохранением"
              message={
                <ul className={styles.findings}>
                  {leaks.map((finding) => (
                    <li key={`${finding.kind}:${finding.line}:${finding.match}`}>
                      строка {finding.line}: {finding.kind} — {finding.match}
                    </li>
                  ))}
                </ul>
              }
            />
          )}
          <div ref={errorRef} role="alert">
            {error && <Alert theme="danger" view="filled" message={error} />}
          </div>
        </div>
      </Dialog.Body>
      <Dialog.Footer
        textButtonCancel="Отмена"
        textButtonApply="Сохранить"
        propsButtonApply={{ loading: isSaving }}
        onClickButtonCancel={requestClose}
        onClickButtonApply={() => void handleSave()}
      />

      <Dialog open={confirmDiscard} onClose={() => setConfirmDiscard(false)} maxWidth="s" aria-labelledby="context-discard-title">
        <Dialog.Header caption="Закрыть без сохранения?" id="context-discard-title" />
        <Dialog.Body>
          <Text variant="body-2">Введённые изменения не сохранены и пропадут.</Text>
        </Dialog.Body>
        <Dialog.Footer
          textButtonCancel="Продолжить редактирование"
          textButtonApply="Закрыть без сохранения"
          propsButtonApply={{ view: 'outlined-danger' }}
          onClickButtonCancel={() => setConfirmDiscard(false)}
          onClickButtonApply={onClose}
        />
      </Dialog>
    </Dialog>
  );
}
