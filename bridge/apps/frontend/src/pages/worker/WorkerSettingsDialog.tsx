import { useState } from 'react';
import { Alert, Checkbox, Dialog, NumberInput, Select, Switch, Text, TextInput } from '@gravity-ui/uikit';

import { type FleetWorker, useListClaudeCredentialsQuery, useUpdateWorkerMutation, type WorkerJobModel } from '../../store/api';
import styles from '../WorkerPage.module.css';
import { MODEL_OPTIONS } from './constants';

interface WorkerSettingsDialogProps {
  worker: FleetWorker;
  onClose: () => void;
}

const MIN_TIMEOUT_MIN = 1;
const MAX_TIMEOUT_MIN = 240;
// Select values are strings; this one is "no token set for the worker".
const DEFAULT_TOKEN = '';

// Everything here applies to a running worker within one poll interval — nothing is restarted or redeployed.
export function WorkerSettingsDialog({ worker, onClose }: WorkerSettingsDialogProps) {
  const [name, setName] = useState(worker.name);
  const [models, setModels] = useState<WorkerJobModel[]>(worker.models ?? MODEL_OPTIONS.map((option) => option.value));
  const [pollIntervalSec, setPollIntervalSec] = useState<number | null>(worker.pollIntervalSec);
  const [timeoutMin, setTimeoutMin] = useState<number | null>(Math.round(worker.jobTimeoutSec / 60));
  const [proxyUrl, setProxyUrl] = useState(worker.proxyUrl ?? '');
  const [chatEnabled, setChatEnabled] = useState(worker.chatEnabled);
  const [tokenId, setTokenId] = useState(worker.claudeCredentialId === null ? DEFAULT_TOKEN : String(worker.claudeCredentialId));
  const { data: credentials } = useListClaudeCredentialsQuery();
  const [error, setError] = useState<string | null>(null);
  const [updateWorker, { isLoading }] = useUpdateWorkerMutation();

  const allModels = models.length === MODEL_OPTIONS.length;
  const timeoutValid = timeoutMin !== null && timeoutMin >= MIN_TIMEOUT_MIN && timeoutMin <= MAX_TIMEOUT_MIN;
  const pollValid = pollIntervalSec !== null && pollIntervalSec >= 2 && pollIntervalSec <= 300;
  const proxyValid = proxyUrl.trim() === '' || /^https?:\/\/\S+$/.test(proxyUrl.trim());
  const canSave = name.trim() !== '' && models.length > 0 && timeoutValid && pollValid && proxyValid;

  const toggleModel = (model: WorkerJobModel, checked: boolean) =>
    setModels((current) => (checked ? [...current, model] : current.filter((candidate) => candidate !== model)));

  const handleSave = async () => {
    if (!canSave) return;
    setError(null);

    try {
      await updateWorker({
        id: worker.id as number,
        name: name.trim(),
        // all five = no restriction (null), so a model added later is not silently excluded
        models: allModels ? null : models,
        pollIntervalSec: pollIntervalSec as number,
        jobTimeoutSec: (timeoutMin as number) * 60,
        proxyUrl: proxyUrl.trim() === '' ? null : proxyUrl.trim(),
        chatEnabled,
        claudeCredentialId: tokenId === DEFAULT_TOKEN ? null : Number(tokenId),
      }).unwrap();
      onClose();
    } catch (err) {
      setError(typeof err === 'string' ? err : 'Не удалось сохранить настройки');
    }
  };

  return (
    <Dialog open onClose={onClose} size="m" aria-labelledby="worker-settings-title">
      <Dialog.Header caption={`Настройки: ${worker.name}`} id="worker-settings-title" />
      <Dialog.Body>
        <div className={styles.dialogForm}>
          <Text color="secondary" variant="caption-2">
            Применяется за один интервал опроса, без перезапуска worker&apos;а.
          </Text>

          <label className={styles.dialogForm}>
            <Text variant="body-2" color="secondary">
              Название
            </Text>
            <TextInput value={name} onUpdate={setName} validationState={name.trim() ? undefined : 'invalid'} />
          </label>

          <fieldset className={styles.dialogForm} style={{ border: 'none', margin: 0, padding: 0 }}>
            <Text as="legend" variant="body-2" color="secondary">
              Какие модели может выполнять
            </Text>
            <div className={styles.checkGroup}>
              {MODEL_OPTIONS.map((option) => (
                <Checkbox
                  key={option.value}
                  checked={models.includes(option.value)}
                  onUpdate={(checked) => toggleModel(option.value, checked)}
                  content={option.content}
                />
              ))}
            </div>
            {models.length === 0 && (
              <Text color="danger" variant="caption-2">
                Выберите хотя бы одну модель.
              </Text>
            )}
          </fieldset>

          <div className={styles.fieldRow}>
            <label className={styles.dialogForm}>
              <Text variant="body-2" color="secondary">
                Опрос bridge, сек
              </Text>
              <NumberInput
                value={pollIntervalSec}
                onUpdate={setPollIntervalSec}
                min={2}
                max={300}
                validationState={pollValid ? undefined : 'invalid'}
              />
            </label>
            <label className={styles.dialogForm}>
              <Text variant="body-2" color="secondary">
                Лимит одной задачи, мин
              </Text>
              <NumberInput
                value={timeoutMin}
                onUpdate={setTimeoutMin}
                min={MIN_TIMEOUT_MIN}
                max={MAX_TIMEOUT_MIN}
                validationState={timeoutValid ? undefined : 'invalid'}
              />
            </label>
          </div>

          <label className={styles.dialogForm}>
            <Text variant="body-2" color="secondary">
              Claude-токен этого worker&apos;а
            </Text>
            <Select
              value={[tokenId]}
              onUpdate={(value) => setTokenId(value[0] ?? DEFAULT_TOKEN)}
              options={[
                { value: DEFAULT_TOKEN, content: 'Первый из списка токенов' },
                ...(credentials ?? []).map((credential) => ({ value: String(credential.id), content: credential.name })),
              ]}
              width="max"
              aria-label="Claude-токен worker'а"
            />
            <Text variant="caption-2" color="secondary">
              Для задач и чата на Sonnet/Opus, если в задаче токен не выбран явно. Выбранный в задаче токен главнее.
            </Text>
          </label>

          <label className={styles.dialogForm}>
            <Text variant="body-2" color="secondary">
              HTTP-прокси к AI-провайдерам (необязательно)
            </Text>
            <TextInput
              value={proxyUrl}
              onUpdate={setProxyUrl}
              placeholder="http://vpn-client:1080"
              hasClear
              validationState={proxyValid ? undefined : 'invalid'}
              errorMessage={proxyValid ? undefined : 'Нужен адрес http:// или https:// (SOCKS не поддерживается)'}
            />
          </label>

          <Switch checked={chatEnabled} onUpdate={setChatEnabled} content="Отвечать на сообщения в чате" />

          {error && <Alert theme="danger" view="filled" message={error} />}
        </div>
      </Dialog.Body>
      <Dialog.Footer
        textButtonCancel="Отмена"
        textButtonApply="Сохранить"
        loading={isLoading}
        propsButtonApply={{ disabled: !canSave }}
        onClickButtonCancel={onClose}
        onClickButtonApply={() => void handleSave()}
      />
    </Dialog>
  );
}
