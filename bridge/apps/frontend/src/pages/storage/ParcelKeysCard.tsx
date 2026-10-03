import { useState } from 'react';
import { TrashBin } from '@gravity-ui/icons';
import { Alert, Button, Card, Icon, Text, TextArea, TextInput } from '@gravity-ui/uikit';

import { useParcelKeys } from '../../shared/lib/parcelKeys';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../StoragePage.module.css';

// Named RSA keys for opening (private) or sending (public) an encrypted
// parcel — imported once here, then picked by name wherever a key would
// otherwise have to be pasted again (this page's "Открыть" action, and
// Worker's decrypt-before-job/encrypt-before-download fields). Stored only
// in this browser's localStorage (see shared/lib/parcelKeys.ts) — bridge
// never sees them.
export function ParcelKeysCard() {
  const { keys, addKey, removeKey } = useParcelKeys();
  const [name, setName] = useState('');
  const [pem, setPem] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleAdd = () => {
    const trimmedName = name.trim();
    const trimmedPem = pem.trim();
    if (!trimmedName || !trimmedPem) return;

    if (!trimmedPem.includes('PRIVATE KEY') && !trimmedPem.includes('PUBLIC KEY')) {
      setError('Похоже, это не ключ (нет заголовка «PRIVATE KEY» или «PUBLIC KEY»)');
      return;
    }

    addKey(trimmedName, trimmedPem);
    setName('');
    setPem('');
    setError(null);
  };

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader title="Ключи для посылок" />
      <Text color="secondary" variant="caption-2">
        Приватный ключ открывает зашифрованную посылку, публичный — шифрует её для получателя.
        Хранятся только в этом браузере, на bridge не отправляются.
      </Text>

      {keys.length > 0 && (
        <ul className={styles.keyList}>
          {keys.map((key) => (
            <li key={key.id} className={styles.keyRow}>
              <Text variant="body-2">{key.name}</Text>
              <Button
                view="flat-danger"
                size="s"
                aria-label={`Удалить ключ: ${key.name}`}
                onClick={() => removeKey(key.id)}
              >
                <Icon data={TrashBin} size={16} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.keyForm}>
        <TextInput value={name} onUpdate={setName} placeholder="Название (например, личный)" />
        <TextArea
          value={pem}
          onUpdate={setPem}
          rows={2}
          placeholder="-----BEGIN PRIVATE KEY----- или -----BEGIN PUBLIC KEY-----"
        />
        <Button view="normal" disabled={!name.trim() || !pem.trim()} onClick={handleAdd}>
          Импортировать
        </Button>
      </div>

      {error && <Alert theme="danger" view="filled" message={error} />}
    </Card>
  );
}
