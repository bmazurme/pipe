import { useState } from 'react';
import { Alert, Button, Text, TextInput } from '@gravity-ui/uikit';

import { useCreateVpnConnectionMutation } from '../../store/api';
import styles from '../VpnPage.module.css';
import { parseVlessLink } from './parseVlessLink';

export function AddConnectionForm({ onDone }: { onDone: () => void }) {
  const [createVpnConnection, { isLoading: isCreating }] = useCreateVpnConnectionMutation();

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

  const canSubmit = Boolean(
    name.trim() && panelUrl.trim() && panelApiToken.trim() && serverAddress.trim(),
  );

  const handleNameChange = (next: string) => {
    setName(next);
    setNameEditedManually(true);
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
      await createVpnConnection({
        name: name.trim(),
        panelUrl: panelUrl.trim(),
        panelApiToken: panelApiToken.trim(),
        serverAddress: serverAddress.trim(),
      }).unwrap();
      onDone();
    } catch (err) {
      setCreateError(typeof err === 'string' ? err : 'Не удалось добавить подключение');
    }
  };

  return (
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
