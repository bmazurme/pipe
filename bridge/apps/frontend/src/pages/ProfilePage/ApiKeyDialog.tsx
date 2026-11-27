import { useEffect, useState } from 'react';
import { Alert, Button, SegmentedRadioGroup, Select, Text, TextInput } from '@gravity-ui/uikit';

import { Dialog } from '../../shared/ui/Dialog';
import { type ApiKeyExpiryDays, describeApiError, useCreateApiKeyMutation } from '../../store/api';
import styles from './ProfilePage.module.css';
import { DEFAULT_EXPIRY, describeNewKey, expiryHint, KEY_PRESETS, NAME_MAX, SCOPE_HINTS, SCOPE_OPTIONS, scopeOf } from './apiKeyDialogUtils';
import { KeyTokenView } from './KeyTokenView';

const EXPIRY_OPTIONS = [
  { value: '30', content: '30 дней' },
  { value: '90', content: '90 дней (по умолчанию)' },
  { value: '365', content: '1 год' },
  { value: 'never', content: 'Бессрочно (осознанно)' },
];

// «Новый API-ключ»: choose what it is for, create it, and make sure the one-time token is copied before the window goes away.
export function ApiKeyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [createApiKey, { isLoading }] = useCreateApiKeyMutation();
  const [name, setName] = useState('');
  const [scope, setScope] = useState('full');
  const [expiry, setExpiry] = useState(DEFAULT_EXPIRY);
  // From the mutation's own response only — never in the store, so the plaintext lives in memory just as long as this dialog.
  const [created, setCreated] = useState<{ token: string; summary: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [warnUncopied, setWarnUncopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setName('');
    setScope('full');
    setExpiry(DEFAULT_EXPIRY);
    setCreated(null);
    setCopied(false);
    setWarnUncopied(false);
    setError(null);
  }, [open]);

  const close = () => {
    setCreated(null);
    onClose();
  };

  // Closing with the token not copied asks once more: after this it cannot be shown again.
  const requestClose = () => {
    if (created && !copied && !warnUncopied) {
      setWarnUncopied(true);

      return;
    }

    close();
  };

  const canCreate = name.trim().length > 0 && !isLoading;

  const handleCreate = async () => {
    if (!canCreate) return;

    setError(null);

    try {
      const result = await createApiKey({
        name: name.trim(),
        scope: scopeOf(scope),
        // «Never» is sent as null, on purpose; the server's default is 90 days.
        expiresInDays: expiry === 'never' ? null : (Number(expiry) as ApiKeyExpiryDays),
      }).unwrap();

      setCreated({ token: result.token, summary: describeNewKey(name.trim(), expiry, scopeOf(scope)) });
    } catch (err) {
      setError(`Не удалось создать ключ: ${describeApiError(err)}`);
    }
  };

  return (
    <Dialog open={open} onClose={requestClose} maxWidth="s" aria-labelledby="create-api-key-title">
      {created ? (
        <>
          <Dialog.Header caption="Ключ создан" id="create-api-key-title" />
          <Dialog.Body>
            <KeyTokenView token={created.token} summary={created.summary} copied={copied} warnUncopied={warnUncopied} onCopied={() => setCopied(true)} />
          </Dialog.Body>
          <Dialog.Footer
            textButtonApply={warnUncopied && !copied ? 'Закрыть без копирования' : 'Готово'}
            propsButtonApply={{ view: warnUncopied && !copied ? 'outlined-danger' : 'action' }}
            onClickButtonApply={requestClose}
          />
        </>
      ) : (
        <>
          <Dialog.Header caption="Новый API-ключ" id="create-api-key-title" />
          <Dialog.Body>
            <div className={styles.dialogForm}>
            <div className={styles.field}>
              <Text variant="body-2" color="secondary">
                Название
              </Text>
              <TextInput
                value={name}
                onUpdate={setName}
                placeholder="sync-cli на ноутбуке"
                autoFocus
                hasClear
                controlProps={{ 'aria-label': 'Название ключа', maxLength: NAME_MAX }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleCreate();
                }}
              />
              <Text color="secondary" variant="caption-2">
                По названию вы потом поймёте, где ключ используется и какой отозвать.
              </Text>
              <div className={styles.presets} role="group" aria-label="Быстрый выбор названия">
                {KEY_PRESETS.map((preset) => (
                  <Button
                    key={preset.name}
                    size="xs"
                    view={name === preset.name ? 'normal' : 'outlined'}
                    selected={name === preset.name}
                    onClick={() => {
                      setName(preset.name);
                      setScope(preset.scope ?? 'full');
                    }}
                  >
                    {preset.name}
                  </Button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <Text variant="body-2" color="secondary">
                Срок действия
              </Text>
              <Select aria-label="Срок действия" value={[expiry]} onUpdate={([value]) => setExpiry(value ?? DEFAULT_EXPIRY)} options={EXPIRY_OPTIONS} width="max" />
              <Text color="secondary" variant="caption-2">
                {expiryHint(expiry)}
              </Text>
            </div>

            <div className={styles.field}>
              <Text variant="body-2" color="secondary">
                Что можно этим ключом
              </Text>
              <SegmentedRadioGroup size="m" value={scope} onUpdate={setScope} options={SCOPE_OPTIONS} aria-label="Область ключа" />
              <Text color="secondary" variant="caption-2">
                {SCOPE_HINTS[scope]}
              </Text>
            </div>

            {error && <Alert theme="danger" view="filled" message={error} />}
            </div>
          </Dialog.Body>
          <Dialog.Footer
            textButtonCancel="Отмена"
            textButtonApply="Создать"
            loading={isLoading}
            propsButtonApply={{ disabled: !canCreate }}
            onClickButtonCancel={close}
            onClickButtonApply={() => void handleCreate()}
          />
        </>
      )}
    </Dialog>
  );
}
