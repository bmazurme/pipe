import { useState } from 'react';
import { Alert, Button, Flex, Select, Text, TextArea, TextInput } from '@gravity-ui/uikit';
import { Dialog } from '../../shared/ui/Dialog';

import { describeApiError } from '../../store/api/describeApiError';
import { useCreateImproveIssueMutation } from '../../store/api';
import { useModelOptions } from '../worker/useModelOptions';

// `model` / `onModelChange` are the Issues tab's own model picker, so the dialog and the toolbar never disagree about which model runs.
export function NewIssueDialog({
  open,
  onClose,
  model,
  onModelChange,
}: {
  open: boolean;
  onClose: () => void;
  model: string;
  onModelChange: (value: string) => void;
}) {
  const { options: modelOptions } = useModelOptions(true);
  const [create, { isLoading }] = useCreateImproveIssueMutation();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  // Which of the two buttons was pressed, so only that one spins.
  const [pending, setPending] = useState<'create' | 'start' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const close = () => {
    setError(null);
    setWarning(null);
    onClose();
  };

  const handleSubmit = async (start: boolean) => {
    setError(null);
    setWarning(null);
    setPending(start ? 'start' : 'create');

    try {
      const result = await create({ title: title.trim(), body, start, model: start ? model : undefined }).unwrap();

      setTitle('');
      setBody('');

      if (result.missingLabels.includes('loop')) {
        setWarning(`Задача #${result.number} создана без метки loop — проверьте права токена (Issues: write) и добавьте метку вручную.`);

        return;
      }

      close();
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setPending(null);
    }
  };

  const blocked = title.trim().length === 0 || Boolean(warning) || isLoading;

  return (
    <Dialog open={open} onClose={close} maxWidth="m" aria-labelledby="new-issue-title">
      <Dialog.Header caption="Новая задача" id="new-issue-title" />
      <Dialog.Body>
        <Flex direction="column" gap={3}>
        <TextInput
          size="m"
          placeholder="Что нужно сделать — коротко"
          value={title}
          autoFocus
          controlProps={{ 'aria-label': 'Заголовок', maxLength: 200 }}
          onUpdate={setTitle}
        />
        <TextArea
          minRows={5}
          placeholder="Описание: контекст, ожидаемый результат, ограничения"
          value={body}
          controlProps={{ 'aria-label': 'Описание', maxLength: 8000 }}
          onUpdate={setBody}
        />
        <Select
          size="m"
          width="max"
          label="Модель:"
          value={[model]}
          onUpdate={([value]) => onModelChange(value)}
          options={modelOptions}
          filterable={modelOptions.length > 8}
          disabled={Boolean(warning)}
        />
        <Text variant="caption-2" color="secondary">
          Модель выполнит задачу при запуске. «Создать» только заводит issue — запустить её можно позже на вкладке «Задачи».
        </Text>
        {warning && <Alert theme="warning" view="filled" message={warning} />}
        {error && <Alert theme="danger" view="filled" message={error} />}
        </Flex>
      </Dialog.Body>
      <Dialog.Footer
        renderButtons={(_apply, cancel) => (
          <>
            {cancel}
            <Button view="outlined" size="l" disabled={blocked} loading={pending === 'create'} onClick={() => void handleSubmit(false)}>
              Создать
            </Button>
            <Button view="action" size="l" disabled={blocked} loading={pending === 'start'} onClick={() => void handleSubmit(true)}>
              Создать и запустить
            </Button>
          </>
        )}
        textButtonCancel={warning ? 'Закрыть' : 'Отмена'}
        onClickButtonCancel={close}
      />
    </Dialog>
  );
}
