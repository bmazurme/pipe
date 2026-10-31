import { useState } from 'react';
import { TrashBin } from '@gravity-ui/icons';
import { Alert, Button, Card, Checkbox, Disclosure, Icon, Select, Skeleton, Switch, Text, TextArea, TextInput } from '@gravity-ui/uikit';
import { Dialog } from '../../shared/ui/Dialog';

import {
  type ProviderAuthScheme,
  type ProviderCredential,
  type ProviderModel,
  type ProviderRoute,
  useCreateProviderCredentialMutation,
  useDeleteProviderCredentialMutation,
  useListProviderCredentialsQuery,
  useListWorkersQuery,
} from '../../store/api';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../WorkerPage.module.css';
import { modelName } from './fleet';
import { AUTH_OPTIONS, describeKey, parseHeaderLines, presetById, PROVIDER_PRESETS, ROUTE_OPTIONS } from './providerPresets';

const PROVIDERS: ProviderModel[] = ['gpt', 'deepseek', 'qwen', 'custom'];
const DEFAULT_PRESET = 'other';

export function ProviderCredentialsCard() {
  const { data: credentials, isLoading, isError, refetch } = useListProviderCredentialsQuery();
  const [createCredential, { isLoading: isCreating }] = useCreateProviderCredentialMutation();
  const [deleteCredential] = useDeleteProviderCredentialMutation();

  const [provider, setProvider] = useState<ProviderModel>('gpt');
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  // A custom key (any OpenAI-compatible server): a template fills these in, every one stays editable.
  const [presetId, setPresetId] = useState(DEFAULT_PRESET);
  const [authScheme, setAuthScheme] = useState<ProviderAuthScheme>('bearer');
  const [route, setRoute] = useState<ProviderRoute>('auto');
  const [headerText, setHeaderText] = useState('');
  const [timeoutSec, setTimeoutSec] = useState('');
  const [supportsTools, setSupportsTools] = useState(true);
  const [stream, setStream] = useState(false);
  const [allowedWorkerIds, setAllowedWorkerIds] = useState<number[]>([]);
  const isCustom = provider === 'custom';
  // Only asked for when a custom key is being made: the list of workers the key can be limited to.
  const { data: workers } = useListWorkersQuery(undefined, { skip: !isCustom });
  const managedWorkers = (Array.isArray(workers) ? workers : []).filter((worker) => worker.kind === 'managed' && worker.id !== null);
  const preset = presetById(presetId);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProviderCredential | null>(null);

  const headers = parseHeaderLines(headerText);
  const timeoutValue = timeoutSec.trim() === '' ? undefined : Number(timeoutSec);
  const timeoutValid = timeoutValue === undefined || (Number.isInteger(timeoutValue) && timeoutValue >= 10 && timeoutValue <= 1800);
  const canSave = isCustom
    ? name.trim() !== '' &&
      baseUrl.trim() !== '' &&
      model.trim() !== '' &&
      (authScheme === 'none' || apiKey.trim() !== '') &&
      headers.invalid.length === 0 &&
      timeoutValid
    : name.trim() !== '' && apiKey.trim() !== '';

  const choosePreset = (id: string) => {
    const chosen = presetById(id);

    setPresetId(id);
    if (!chosen) return;
    setBaseUrl(chosen.baseUrl);
    setAuthScheme(chosen.authScheme);
    setRoute(chosen.route);
    setHeaderText(Object.keys(chosen.headerHints).map((header) => `${header}: `).join('\n'));
  };

  const handleCreate = async () => {
    if (!canSave) return;
    setError(null);

    try {
      await createCredential({
        provider,
        name: name.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        ...(model.trim() ? { model: model.trim() } : {}),
        ...(isCustom
          ? {
              authScheme,
              route,
              supportsTools,
              ...(stream ? { stream: true } : {}),
              preset: presetId,
              ...(Object.keys(headers.headers).length > 0 ? { extraHeaders: headers.headers } : {}),
              ...(timeoutValue !== undefined ? { timeoutSec: timeoutValue } : {}),
              ...(allowedWorkerIds.length > 0 ? { allowedWorkerIds } : {}),
            }
          : {}),
      }).unwrap();
      setName('');
      setApiKey('');
      setBaseUrl('');
      setModel('');
      setHeaderText('');
      setTimeoutSec('');
      setSupportsTools(true);
      setStream(false);
      setAllowedWorkerIds([]);
      setPresetId(DEFAULT_PRESET);
      setAuthScheme('bearer');
      setRoute('auto');
    } catch (err) {
      setError(typeof err === 'string' ? err : 'Не удалось сохранить ключ');
    }
  };

  const handleDelete = async (credential: ProviderCredential) => {
    setError(null);
    setDeletingId(credential.id);

    try {
      await deleteCredential(credential.id).unwrap();
    } catch {
      setError(`Не удалось удалить ключ «${credential.name}»`);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader
        title="API-ключи моделей"
        meta={credentials && credentials.length > 0 ? String(credentials.length) : undefined}
      />
      <Text color="secondary" variant="caption-2">
        Ключи GPT, DeepSeek и Qwen хранятся в bridge в зашифрованном виде и выдаются worker&apos;у вместе с задачей — в
        его переменных среды ничего не нужно, передеплой не требуется. По умолчанию берётся первый добавленный ключ
        провайдера; в форме задачи можно выбрать другой. «Другая модель» — любой OpenAI-совместимый сервер (Yandex AI Studio,
        Gemini, Ollama…): её ключ в форме задачи выбирается всегда.
      </Text>

      {isLoading && <Skeleton height={40} />}

      {isError && (
        <Alert
          theme="danger"
          view="filled"
          message="Не удалось загрузить список ключей"
          actions={
            <Button view="outlined" size="s" onClick={() => void refetch()}>
              Повторить
            </Button>
          }
        />
      )}

      {!isLoading && !isError && credentials && credentials.length === 0 && (
        <Text color="secondary" variant="body-2">
          Ключей пока нет — задачи будут использовать ключи из переменных среды worker&apos;а. Добавьте первый ниже.
        </Text>
      )}

      {credentials && credentials.length > 0 && (
        <ul className={styles.jobList}>
          {credentials.map((credential: ProviderCredential) => (
            <li key={credential.id} className={styles.credentialRow}>
              <div className={styles.jobRowMain}>
                <Text variant="body-2">
                  {modelName(credential.provider)} · {credential.name}
                </Text>
                <Text color="secondary" variant="caption-2">
                  {credential.keyHint}
                  {credential.baseUrl && ` · ${credential.baseUrl}`}
                  {credential.model && ` · ${credential.model}`}
                </Text>
                {credential.provider === 'custom' && (
                  <Text color="secondary" variant="caption-2">
                    {describeKey(credential)}
                  </Text>
                )}
              </div>
              <Button
                view="flat-danger"
                size="s"
                aria-label={`Удалить ключ: ${credential.name}`}
                loading={deletingId === credential.id}
                onClick={() => {
                  setError(null);
                  setPendingDelete(credential);
                }}
              >
                <Icon data={TrashBin} size={16} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.dialogForm}>
        <div className={styles.fieldRow}>
          <Select
            value={[provider]}
            onUpdate={([value]) => setProvider((value as ProviderModel) ?? 'gpt')}
            options={PROVIDERS.map((value) => ({
              value,
              content: modelName(value),
            }))}
            aria-label="Провайдер"
            width="max"
          />
          <TextInput
            value={name}
            onUpdate={setName}
            placeholder="Название ключа (например, рабочий)"
            controlProps={{ 'aria-label': 'Название ключа' }}
          />
        </div>
        {isCustom && (
          <>
            <Select
              value={[presetId]}
              onUpdate={([value]) => choosePreset(value ?? DEFAULT_PRESET)}
              options={PROVIDER_PRESETS.map((item) => ({ value: item.id, content: item.label }))}
              aria-label="Шаблон"
              width="max"
            />
            {preset && (
              <Alert
                theme="info"
                view="outlined"
                message={
                  <>
                    Содержимое задач и чатов уйдёт: <b>{preset.dataGoesTo}</b>. {preset.note}
                  </>
                }
              />
            )}
            <div className={styles.fieldRow}>
              <TextInput value={baseUrl} onUpdate={setBaseUrl} placeholder="Адрес API, например http://localhost:11434/v1" controlProps={{ 'aria-label': 'Адрес API' }} />
              <TextInput value={model} onUpdate={setModel} placeholder={`Модель: ${preset?.modelHint ?? 'название'}`} controlProps={{ 'aria-label': 'Модель' }} />
            </div>
            <div className={styles.fieldRow}>
              <Select
                value={[authScheme]}
                onUpdate={([value]) => setAuthScheme((value as ProviderAuthScheme) ?? 'bearer')}
                options={AUTH_OPTIONS}
                aria-label="Авторизация"
                width="max"
              />
              <Select
                value={[route]}
                onUpdate={([value]) => setRoute((value as ProviderRoute) ?? 'auto')}
                options={ROUTE_OPTIONS}
                aria-label="Маршрут"
                width="max"
              />
            </div>
            <Text color="secondary" variant="caption-2">
              Маршрут меняется в любой момент и действует со следующей задачи; уже запущенная держит свой.
            </Text>
          </>
        )}
        {(!isCustom || authScheme !== 'none') && (
          <TextInput
            type="password"
            value={apiKey}
            onUpdate={setApiKey}
            placeholder="API-ключ"
            controlProps={{ 'aria-label': 'API-ключ' }}
            hasClear
            autoComplete="off"
          />
        )}

        {isCustom ? (
          <Disclosure summary="Дополнительно: заголовки, таймаут, функции, поток, worker'ы">
            <div className={styles.dialogForm}>
              <TextArea
                value={headerText}
                onUpdate={setHeaderText}
                rows={3}
                placeholder="Заголовки, по одному в строке: имя: значение"
                controlProps={{ 'aria-label': 'Заголовки' }}
                validationState={headers.invalid.length > 0 ? 'invalid' : undefined}
                errorMessage={headers.invalid.length > 0 ? `Не разобрать: ${headers.invalid[0]}` : undefined}
              />
              {preset && Object.keys(preset.headerHints).length > 0 && (
                <Text color="secondary" variant="caption-2">
                  {Object.entries(preset.headerHints)
                    .map(([header, hint]) => `${header} — ${hint}`)
                    .join('; ')}
                </Text>
              )}
              <TextInput
                value={timeoutSec}
                onUpdate={setTimeoutSec}
                placeholder="Таймаут одного запроса, с (10–1800; по умолчанию 300)"
                controlProps={{ 'aria-label': 'Таймаут' }}
                validationState={timeoutValid ? undefined : 'invalid'}
              />
              <Switch checked={supportsTools} onUpdate={setSupportsTools} content="Модель вызывает функции (нужно для задач; без этого — только чат)" />
              <Switch checked={stream} onUpdate={setStream} content="Потоковая выдача в чате (ответ появляется по мере генерации)" />
              {managedWorkers.length > 0 && (
                <fieldset className={styles.dialogForm} style={{ border: 'none', margin: 0, padding: 0 }}>
                  <Text as="legend" variant="body-2" color="secondary">
                    Только на этих worker&apos;ах (пусто = на любых)
                  </Text>
                  {managedWorkers.map((worker) => (
                    <Checkbox
                      key={worker.id}
                      checked={allowedWorkerIds.includes(worker.id as number)}
                      onUpdate={(checked) =>
                        setAllowedWorkerIds((current) =>
                          checked ? [...current, worker.id as number] : current.filter((id) => id !== worker.id),
                        )
                      }
                      content={worker.name}
                    />
                  ))}
                  <Text color="secondary" variant="caption-2">
                    Локальная модель достижима только из вашей сети — ограничьте ключ машиной, где она стоит.
                  </Text>
                </fieldset>
              )}
            </div>
          </Disclosure>
        ) : (
          <Disclosure summary="Свой адрес или модель (необязательно)">
            <div className={styles.fieldRow}>
              <TextInput
                value={baseUrl}
                onUpdate={setBaseUrl}
                placeholder="https://api.example.com/v1"
                controlProps={{ 'aria-label': 'Адрес API' }}
              />
              <TextInput value={model} onUpdate={setModel} placeholder="Модель, например gpt-4o" controlProps={{ 'aria-label': 'Модель' }} />
            </div>
          </Disclosure>
        )}

        <div>
          <Button view="normal" loading={isCreating} disabled={!canSave} onClick={() => void handleCreate()}>
            Добавить ключ
          </Button>
        </div>
      </div>

      {error && <Alert theme="danger" view="filled" message={error} />}

      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        maxWidth="s"
        aria-labelledby="delete-provider-credential-title"
      >
        <Dialog.Header caption="Удалить ключ?" id="delete-provider-credential-title" />
        <Dialog.Body>
          <Text color="secondary">Ключ «{pendingDelete?.name}» будет удалён без возможности восстановления.</Text>
        </Dialog.Body>
        <Dialog.Footer
          preset="danger"
          textButtonCancel="Отмена"
          textButtonApply="Удалить"
          onClickButtonCancel={() => setPendingDelete(null)}
          onClickButtonApply={() => {
            const target = pendingDelete;
            setPendingDelete(null);
            if (target) void handleDelete(target);
          }}
        />
      </Dialog>
    </Card>
  );
}
