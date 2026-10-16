import { useRef, useState, type ChangeEvent } from 'react';
import { Alert, Button, Dialog, Loader, Text, TextArea, TextInput } from '@gravity-ui/uikit';
import { scanForLeaks, type LeakFinding } from '@pipe/protocol/leakScan';

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

  const [notice, setNotice] = useState<string | null>(null);
  const [leaks, setLeaks] = useState<LeakFinding[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setNotice(null);
    setLeaks([]);

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
    setLeaks(scanForLeaks([{ source: file.name, content: loaded }]));
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
          <input
            ref={fileInput}
            type="file"
            accept=".md,.mdx,.txt,.json,.yml,.yaml,.xml,.html,.css,.sql,.sh,.js,.ts"
            aria-label="Файл с текстом контекста"
            hidden
            onChange={(event) => void handleFile(event)}
          />
          <div>
            <Button view="outlined" onClick={() => fileInput.current?.click()}>
              Загрузить из файла
            </Button>
          </div>
          {notice && <Alert theme="warning" message={notice} />}
          {leaks.length > 0 && (
            <Alert
              theme="warning"
              title="В файле найдено похожее на секреты — проверьте текст перед сохранением"
              message={
                <ul>
                  {leaks.map((finding) => (
                    <li key={`${finding.kind}:${finding.line}:${finding.match}`}>
                      строка {finding.line}: {finding.kind} — {finding.match}
                    </li>
                  ))}
                </ul>
              }
            />
          )}
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
