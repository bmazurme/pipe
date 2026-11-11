import { useState } from 'react';
import { Alert, Button, SegmentedRadioGroup, Text, TextInput } from '@gravity-ui/uikit';

import { useCreateVpnConnectionMutation } from '../../store/api';
import styles from '../VpnPage.module.css';
import { parseSubscriptionLink, parseVlessLink } from './parseVlessLink';

type Mode = 'subscription' | 'panel';

export function AddConnectionForm({ onDone }: { onDone: () => void }) {
  const [createVpnConnection, { isLoading: isCreating }] = useCreateVpnConnectionMutation();

  const [mode, setMode] = useState<Mode>('subscription');
  const [subscriptionUrl, setSubscriptionUrl] = useState('');
  const [vlessLink, setVlessLink] = useState('');
  const [name, setName] = useState('');
  // Distinct from `!name.trim()` — typing the link char by char (as in a
  // real paste-then-edit, or just `userEvent.type`) parses a valid URL
  // before its #fragment is fully there yet, autofilling a truncated name;
  // gating on "was this field ever touched directly" instead of "is it
  // currently empty" means later, more-complete parses keep overwriting it
  // instead of getting locked out by their own earlier partial fill.
  const [nameEditedManually, setNameEditedManually] = useState(false);
  const [panelUrl, setPanelUrl] = useState('');
  const [panelApiToken, setPanelApiToken] = useState('');
  const [serverAddress, setServerAddress] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const subscription = parseSubscriptionLink(subscriptionUrl);
  // A subscription needs only its link: without a name the provider's own (#PaperVPN), then the host, is used.
  const canSubmit =
    mode === 'subscription'
      ? subscription !== null
      : Boolean(name.trim() && panelUrl.trim() && panelApiToken.trim() && serverAddress.trim());

  const handleNameChange = (next: string) => {
    setName(next);
    setNameEditedManually(true);
  };

  const handleSubscriptionChange = (next: string) => {
    setSubscriptionUrl(next);
    const parsed = parseSubscriptionLink(next);

    if (parsed?.name && !nameEditedManually) {
      setName(parsed.name);
    }
  };

  const handleVlessLinkChange = (next: string) => {
    setVlessLink(next);
    const parsed = parseVlessLink(next);
    if (!parsed) return;

    setServerAddress(parsed.serverAddress);
    if (parsed.name && !nameEditedManually) {
      setName(parsed.name);
    }
  };

  const handleCreate = async () => {
    if (!canSubmit) return;
    setCreateError(null);

    try {
      if (mode === 'subscription' && subscription) {
        await createVpnConnection({
          name: name.trim() || subscription.name || subscription.host,
          subscriptionUrl: subscriptionUrl.trim(),
        }).unwrap();
      } else {
        await createVpnConnection({
          name: name.trim(),
          panelUrl: panelUrl.trim(),
          panelApiToken: panelApiToken.trim(),
          serverAddress: serverAddress.trim(),
        }).unwrap();
      }
      onDone();
    } catch (err) {
      setCreateError(typeof err === 'string' ? err : 'Не удалось добавить подключение');
    }
  };

  return (
    <>
      <SegmentedRadioGroup value={mode} onUpdate={(value) => setMode(value as Mode)} aria-label="Тип подключения">
        <SegmentedRadioGroup.Option value="subscription">Ссылка подписки</SegmentedRadioGroup.Option>
        <SegmentedRadioGroup.Option value="panel">Панель 3x-ui</SegmentedRadioGroup.Option>
      </SegmentedRadioGroup>

      {mode === 'subscription' ? (
        <>
          <label className={styles.secretField}>
            <Text variant="body-2" color="secondary">
              Ссылка подписки
            </Text>
            <TextInput
              value={subscriptionUrl}
              onUpdate={handleSubscriptionChange}
              placeholder="https://провайдер.example/…#Название"
              hasClear
              autoFocus
              validationState={subscriptionUrl.trim() !== '' && subscription === null ? 'invalid' : undefined}
              errorMessage={subscriptionUrl.trim() !== '' && subscription === null ? 'Нужна ссылка https://…' : undefined}
            />
            <Text color="secondary" variant="caption-2">
              Ссылку выдаёт VPN-провайдер. Bridge скачает по ней список, возьмёт первую ссылку vless:// (Reality, tcp) и
              покажет сервер. В ссылке ваш токен: она хранится зашифрованной и больше не показывается.
            </Text>
          </label>
          <label className={styles.secretField}>
            <Text variant="body-2" color="secondary">
              Название
            </Text>
            <TextInput
              value={name}
              onUpdate={handleNameChange}
              placeholder={subscription?.name ?? 'Подставится из ссылки (после #)'}
            />
          </label>
        </>
      ) : (
        <>
          <label className={styles.secretField}>
            <Text variant="body-2" color="secondary">
              Вставить ссылку подключения (необязательно)
            </Text>
            <TextInput
              value={vlessLink}
              onUpdate={handleVlessLinkChange}
              placeholder="vless://uuid@host:port?...#название"
              hasClear
              autoFocus
            />
            <Text color="secondary" variant="caption-2">
              Подставит адрес сервера (и название, если оно не указано) — URL и токен панели ссылка не
              содержит, их нужно ввести отдельно.
            </Text>
          </label>

          <div className={styles.provisionGrid}>
            <label className={styles.secretField}>
              <Text variant="body-2" color="secondary">
                Название
              </Text>
              <TextInput value={name} onUpdate={handleNameChange} placeholder="Например, Нидерланды" />
            </label>
            <label className={styles.secretField}>
              <Text variant="body-2" color="secondary">
                URL панели
              </Text>
              <TextInput value={panelUrl} onUpdate={setPanelUrl} placeholder="http://1.2.3.4:2053/abcdef" />
            </label>
            <label className={styles.secretField}>
              <Text variant="body-2" color="secondary">
                API-токен панели
              </Text>
              <TextInput type="password" value={panelApiToken} onUpdate={setPanelApiToken} hasClear />
            </label>
            <label className={styles.secretField}>
              <Text variant="body-2" color="secondary">
                Адрес сервера
              </Text>
              <TextInput value={serverAddress} onUpdate={setServerAddress} placeholder="1.2.3.4" />
            </label>
          </div>
        </>
      )}

      <div className={styles.connectionActions}>
        <Button view="action" loading={isCreating} disabled={!canSubmit} onClick={() => void handleCreate()}>
          Добавить подключение
        </Button>
        <Button view="flat" onClick={onDone}>
          Отмена
        </Button>
      </div>

      {createError && <Alert theme="danger" view="filled" message={createError} />}
    </>
  );
}
