import { useState } from 'react';
import { Alert, Dialog, Text, TextArea } from '@gravity-ui/uikit';

import { decryptParcel, stripEncryptedSuffix, triggerBlobDownload } from '../../shared/lib/parcelCrypto';
import { useParcelKeys } from '../../shared/lib/parcelKeys';
import { StoredFileMeta, usePeekFileMutation } from '../../store/api';
import { ParcelKeyPicker } from '../../widgets/ParcelKeyPicker';
import styles from '../StoragePage.module.css';

interface OpenEncryptedFileDialogProps {
  file: StoredFileMeta;
  onClose: () => void;
}

// A parcel pushed from reports' Subscription module (or sync, with a
// publicKeyPath configured) can land in Storage already encrypted — this
// lets it actually be opened here instead of only ever downloadable as
// opaque ciphertext. Uses /peek (non-destructive raw-bytes read), not
// /download, so the original encrypted file stays in Storage for whoever
// it was actually encrypted for.
export function OpenEncryptedFileDialog({ file, onClose }: OpenEncryptedFileDialogProps) {
  const { keys } = useParcelKeys();
  const [peekFile] = usePeekFileMutation();
  const [key, setKey] = useState('');
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpen = async () => {
    if (!key.trim()) return;
    setError(null);
    setIsDecrypting(true);

    try {
      const encrypted = await peekFile(file.id).unwrap();
      const decrypted = await decryptParcel(encrypted, key.trim());
      triggerBlobDownload(decrypted, stripEncryptedSuffix(file.originalName));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось расшифровать');
    } finally {
      setIsDecrypting(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="s" aria-labelledby="open-encrypted-title">
      <Dialog.Header caption={`Открыть «${file.originalName}»`} id="open-encrypted-title" />
      <Dialog.Body>
        <Text color="secondary" variant="body-2">
          Приватный ключ для расшифровки — используется только в браузере, на сервер не
          отправляется. Исходный зашифрованный файл остаётся в Storage.
        </Text>
        <div className={styles.decryptField}>
          <ParcelKeyPicker keys={keys} onPick={setKey} />
          <TextArea value={key} onUpdate={setKey} rows={3} placeholder="-----BEGIN PRIVATE KEY-----" />
        </div>
        {error && <Alert theme="danger" view="filled" message={error} />}
      </Dialog.Body>
      <Dialog.Footer
        textButtonCancel="Отмена"
        textButtonApply="Расшифровать и скачать"
        propsButtonApply={{ loading: isDecrypting, disabled: !key.trim() }}
        onClickButtonCancel={onClose}
        onClickButtonApply={() => void handleOpen()}
      />
    </Dialog>
  );
}
