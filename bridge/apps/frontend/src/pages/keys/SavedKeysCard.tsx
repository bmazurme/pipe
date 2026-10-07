import { useEffect, useState } from 'react';
import { ArrowDownToLine, Lock, TrashBin } from '@gravity-ui/icons';
import { Alert, Button, Card, ClipboardButton, Icon, Label, Text, TextArea, TextInput } from '@gravity-ui/uikit';

import { fingerprintOfPublicKey, keyFileName, keyKind } from '../../shared/lib/keyGeneration';
import { triggerBlobDownload } from '../../shared/lib/parcelCrypto';
import { StoredParcelKey } from '../../shared/lib/parcelKeys';
import { EmptyState } from '../../widgets/EmptyState';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../KeysPage.module.css';

function KeyRow({ keyEntry, onRemove }: { keyEntry: StoredParcelKey; onRemove: () => void }) {
  const kind = keyKind(keyEntry.pem);
  const [fingerprint, setFingerprint] = useState<string | null>(null);

  // Only public keys get a fingerprint: it is derived from the public key's DER, and a
  // private one would have to be parsed for it. The fingerprint lets a pair be matched.
  useEffect(() => {
    let cancelled = false;

    if (kind === 'public') {
      fingerprintOfPublicKey(keyEntry.pem)
        .then((value) => !cancelled && setFingerprint(value))
        .catch(() => undefined);
    }

    return () => {
      cancelled = true;
    };
  }, [kind, keyEntry.pem]);

  return (
    <li className={styles.keyRow}>
      <div className={styles.keyInfo}>
        <Text variant="body-2" ellipsis title={keyEntry.name}>{keyEntry.name}</Text>
        {fingerprint && (
          <Text variant="caption-2" color="secondary" className={styles.fingerprint} ellipsis title={fingerprint}>
            {fingerprint}
          </Text>
        )}
      </div>
      {kind && <Label theme={kind === 'private' ? 'danger' : 'info'} size="s">{kind === 'private' ? 'приватный' : 'публичный'}</Label>}
      <ClipboardButton text={keyEntry.pem} size="s" view="flat-secondary" tooltipInitialText="Скопировать ключ" tooltipSuccessText="Скопировано" />
      <Button
        view="flat-secondary"
        size="s"
        aria-label={`Скачать ключ: ${keyEntry.name}`}
        onClick={() => triggerBlobDownload(new Blob([keyEntry.pem], { type: 'application/x-pem-file' }), keyFileName(keyEntry.name, kind ?? 'public'))}
      >
        <Icon data={ArrowDownToLine} size={16} />
      </Button>
      <Button view="flat-danger" size="s" aria-label={`Удалить ключ: ${keyEntry.name}`} onClick={onRemove}>
        <Icon data={TrashBin} size={16} />
      </Button>
    </li>
  );
}

interface SavedKeysCardProps {
  keys: StoredParcelKey[];
  addKey: (name: string, pem: string) => void;
  removeKey: (id: string) => void;
}

export function SavedKeysCard({ keys, addKey, removeKey }: SavedKeysCardProps) {
  const [name, setName] = useState('');
  const [pem, setPem] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleImport = () => {
    const label = name.trim();
    const value = pem.trim();

    if (!label || !value) return;

    if (!keyKind(value)) {
      setError('Похоже, это не ключ (нет заголовка «PRIVATE KEY» или «PUBLIC KEY»)');
      return;
    }

    addKey(label, value);
    setName('');
    setPem('');
    setError(null);
  };

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader title="Ключи в этом браузере" meta={keys.length > 0 ? String(keys.length) : undefined} />
      <Text color="secondary" variant="caption-2">
        Хранятся только здесь (localStorage), на bridge не отправляются. Те же ключи можно выбрать по имени в Storage и Worker.
      </Text>

      {keys.length === 0 ? (
        <EmptyState icon={Lock} title="Ключей пока нет" description="Сгенерируйте пару выше или импортируйте существующий ключ." />
      ) : (
        <ul className={styles.keyList}>
          {keys.map((entry) => (
            <KeyRow key={entry.id} keyEntry={entry} onRemove={() => removeKey(entry.id)} />
          ))}
        </ul>
      )}

      <div className={styles.importForm}>
        <Text variant="subheader-1">Импортировать ключ</Text>
        <TextInput value={name} onUpdate={setName} placeholder="Название" />
        <TextArea value={pem} onUpdate={setPem} rows={3} placeholder="-----BEGIN PRIVATE KEY----- или -----BEGIN PUBLIC KEY-----" />
        <div>
          <Button view="normal" disabled={!name.trim() || !pem.trim()} onClick={handleImport}>
            Импортировать
          </Button>
        </div>
      </div>

      {error && <Alert theme="danger" view="filled" message={error} />}
    </Card>
  );
}
