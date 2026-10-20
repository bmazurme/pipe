import { useState } from 'react';
import { Alert, Select, Switch, TextArea, TextInput } from '@gravity-ui/uikit';
import { Dialog } from '../../shared/ui/Dialog';

import { describeApiError } from '../../store/api/describeApiError';
import { useCreateImproveIssueMutation } from '../../store/api';
import { MODEL_OPTIONS } from '../worker/constants';

export function NewIssueDialog({ open, onClose, defaultModel }: { open: boolean; onClose: () => void; defaultModel: string }) {
  const [create, { isLoading }] = useCreateImproveIssueMutation();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [start, setStart] = useState(false);
  const [model, setModel] = useState(defaultModel);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const close = () => {
    setError(null);
    setWarning(null);
    onClose();
  };

  const handleSubmit = async () => {
    setError(null);
    setWarning(null);

    try {
      const result = await create({ title: title.trim(), body, start, model: start ? model : undefined }).unwrap();

      setTitle('');
      setBody('');
      setStart(false);

      if (result.missingLabels.includes('loop')) {
        setWarning(`Задача #${result.number} создана без метки loop — проверьте права токена (Issues: write) и добавьте метку вручную.`);

        return;
      }

      close();
    } catch (err) {
      setError(describeApiError(err));
    }
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="m" aria-labelledby="new-issue-title">
      <Dialog.Header caption="Новая задача" id="new-issue-title" />
      <Dialog.Body>
        <TextInput
          size="m"
          placeholder="Заголовок"
          value={title}
          controlProps={{ 'aria-label': 'Заголовок', maxLength: 200 }}
          onUpdate={setTitle}
        />
        <TextArea
          minRows={5}
          placeholder="Описание"
          value={body}
          controlProps={{ 'aria-label': 'Описание', maxLength: 8000 }}
          onUpdate={setBody}
        />
        <Switch checked={start} onUpdate={setStart} content="Сразу запустить" />
        {start && <Select size="m" label="Модель:" value={[model]} onUpdate={([value]) => setModel(value)} options={MODEL_OPTIONS} />}
        {warning && <Alert theme="warning" view="filled" message={warning} />}
        {error && <Alert theme="danger" view="filled" message={error} />}
      </Dialog.Body>
      <Dialog.Footer
        textButtonCancel={warning ? 'Закрыть' : 'Отмена'}
        textButtonApply="Создать"
        propsButtonApply={{ view: 'action', loading: isLoading, disabled: title.trim().length === 0 || Boolean(warning) }}
        onClickButtonCancel={close}
        onClickButtonApply={() => void handleSubmit()}
      />
    </Dialog>
  );
}
