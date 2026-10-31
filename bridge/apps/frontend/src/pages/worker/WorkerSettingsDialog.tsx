import { useState } from 'react';
import { Alert, Checkbox, NumberInput, Select, Switch, Text, TextInput } from '@gravity-ui/uikit';
import { Dialog } from '../../shared/ui/Dialog';

import { type FleetWorker, useUpdateWorkerMutation, type WorkerJobModel } from '../../store/api';
import styles from '../WorkerPage.module.css';
import { MODEL_OPTIONS } from './constants';
import { ClaudeTokenField, DEFAULT_TOKEN, isVlessLink, VpnLinkField, VpnSourceField, type VpnSource } from './WorkerAccessFields';

interface WorkerSettingsDialogProps {
  worker: FleetWorker;
  onClose: () => void;
}

const LIMITS_REFRESH_OPTIONS = [
  { value: '0', content: 'Выключено — по кнопке и после запусков' },
  { value: '15', content: 'Каждые 15 минут' },
  { value: '30', content: 'Каждые 30 минут' },
  { value: '60', content: 'Каждый час' },
  { value: '120', content: 'Каждые 2 часа' },
];

const MIN_TIMEOUT_MIN = 1;
const MAX_TIMEOUT_MIN = 240;

// Everything here applies to a running worker within one poll interval — nothing is restarted or redeployed.
export function WorkerSettingsDialog({ worker, onClose }: WorkerSettingsDialogProps) {
  const [name, setName] = useState(worker.name);
  const [models, setModels] = useState<WorkerJobModel[]>(worker.models ?? MODEL_OPTIONS.map((option) => option.value));
  const [pollIntervalSec, setPollIntervalSec] = useState<number | null>(worker.pollIntervalSec);
  const [timeoutMin, setTimeoutMin] = useState<number | null>(Math.round(worker.jobTimeoutSec / 60));
  const [proxyUrl, setProxyUrl] = useState(worker.proxyUrl ?? '');
  const proxyEdited = proxyUrl !== (worker.proxyUrl ?? '');
  const [chatEnabled, setChatEnabled] = useState(worker.chatEnabled);
  const [fusion, setFusion] = useState((worker.capabilities ?? []).includes('fusion'));
  const [limitsRefreshMin, setLimitsRefreshMin] = useState(String(worker.limitsRefreshMin ?? 0));
  const [tokenId, setTokenId] = useState(worker.claudeCredentialId === null ? DEFAULT_TOKEN : String(worker.claudeCredentialId));
  // undefined = the VPN is left as it is, null = removed, a string = replaced
  const [vpnChange, setVpnChange] = useState<string | null | undefined>(undefined);
  const [vpnSource, setVpnSource] = useState<VpnSource>(worker.vpnSource ?? 'link');
  const [vpnConnectionId, setVpnConnectionId] = useState<number | null>(worker.vpnConnectionId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [updateWorker, { isLoading }] = useUpdateWorkerMutation();

  const allModels = models.length === MODEL_OPTIONS.length;
  const timeoutValid = timeoutMin !== null && timeoutMin >= MIN_TIMEOUT_MIN && timeoutMin <= MAX_TIMEOUT_MIN;
  const pollValid = pollIntervalSec !== null && pollIntervalSec >= 2 && pollIntervalSec <= 300;
  const proxyValid = proxyUrl.trim() === '' || /^https?:\/\/\S+$/.test(proxyUrl.trim());
  const vpnValid = typeof vpnChange !== 'string' || isVlessLink(vpnChange);
  const vpnSourceValid = vpnSource !== 'connection' || vpnConnectionId !== null;
  const vpnSourceEdited =
    vpnSource !== (worker.vpnSource ?? 'link') || (vpnSource === 'connection' && vpnConnectionId !== (worker.vpnConnectionId ?? null));
  const canSave = name.trim() !== '' && models.length > 0 && timeoutValid && pollValid && proxyValid && vpnValid && vpnSourceValid;

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
        // left out when untouched: the field holds the masked value, which must never overwrite the real URL
        ...(proxyEdited ? { proxyUrl: proxyUrl.trim() === '' ? null : proxyUrl.trim() } : {}),
        chatEnabled,
        capabilities: fusion ? ['fusion'] : [],
        limitsRefreshMin: Number(limitsRefreshMin),
        claudeCredentialId: tokenId === DEFAULT_TOKEN ? null : Number(tokenId),
        ...(vpnChange !== undefined && vpnSource === 'link' ? { vpnLink: vpnChange } : {}),
        ...(vpnSourceEdited ? { vpnSource, vpnConnectionId: vpnSource === 'connection' ? vpnConnectionId : null } : {}),
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

          <ClaudeTokenField value={tokenId} onChange={setTokenId} />

          <VpnSourceField
            source={vpnSource}
            connectionId={vpnConnectionId}
            onChange={(source, connectionId) => {
              setVpnSource(source);
              setVpnConnectionId(connectionId);
            }}
          />

          {vpnSource === 'link' && <VpnLinkField currentHost={worker.vpnSource === 'link' ? worker.vpnHost : null} onChange={setVpnChange} />}

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

          <label className={styles.dialogForm}>
            <Text variant="body-2" color="secondary">
              Автообновление лимитов Claude
            </Text>
            <Select
              value={[limitsRefreshMin]}
              onUpdate={(value) => setLimitsRefreshMin(value[0] ?? '0')}
              options={LIMITS_REFRESH_OPTIONS}
              width="max"
              aria-label="Автообновление лимитов"
            />
            <Text variant="caption-2" color="secondary">
              Пока worker свободен, он сам делает один крошечный запрос к Claude (около 4 тысяч токенов) и обновляет полоски лимитов. По умолчанию выключено:
              лимиты обновляются после запусков и по кнопке «Обновить лимиты».
            </Text>
          </label>

          <Switch checked={chatEnabled} onUpdate={setChatEnabled} content="Отвечать на сообщения в чате" />

          <Switch checked={fusion} onUpdate={setFusion} content="Fusion 360 на этом компьютере" />
          <Text variant="caption-2" color="secondary">
            Для worker&apos;а на Mac с открытым Fusion 360 и установленным add-in (worker/fusion-addin). Только он берёт задачи Lab с выбором «Fusion 360 на Mac».
          </Text>

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
