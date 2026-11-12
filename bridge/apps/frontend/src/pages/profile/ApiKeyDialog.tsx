import { useEffect, useState } from 'react';
import { Check, Copy } from '@gravity-ui/icons';
import { Alert, Button, Checkbox, Icon, Select, Text, TextInput } from '@gravity-ui/uikit';

import { Dialog } from '../../shared/ui/Dialog';
import { API_URL, type ApiKeyExpiryDays, describeApiError, useCreateApiKeyMutation } from '../../store/api';
import styles from '../ProfilePage.module.css';
import { BOARDS_ONLY_HINT, describeNewKey, expiryHint, KEY_PRESETS, NAME_MAX, usageExample } from './apiKeyDialogUtils';

const EXPIRY_OPTIONS = [
  { value: 'never', content: 'Бессрочно' },
  { value: '30', content: '30 дней' },
  { value: '90', content: '90 дней' },
  { value: '365', content: '1 год' },
];

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);

    return true;
  } catch {
    return false;
  }
}

// A token and a button that says plainly whether it was copied. Select-all on click is the fallback when the clipboard is refused.
function CopyRow({ text, label, onCopied, strong = false }: { text: string; label: string; onCopied?: () => void; strong?: boolean }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const copy = async () => {
    const ok = await copyText(text);

    setState(ok ? 'copied' : 'failed');
    if (ok) onCopied?.();
  };

  return (
    <div className={styles.copyRow}>
      <code className={styles.tokenBox} onClick={(event) => window.getSelection()?.selectAllChildren(event.currentTarget)}>
        {text}
      </code>
      <Button view={strong && state !== 'copied' ? 'action' : 'outlined'} size={strong ? 'l' : 'm'} onClick={() => void copy()} aria-label={label}>
        <Icon data={state === 'copied' ? Check : Copy} size={16} />
        {state === 'copied' ? 'Скопировано' : strong ? 'Скопировать ключ' : 'Скопировать'}
      </Button>
      {state === 'failed' && (
        <Text color="danger" variant="caption-2">
          Браузер не дал скопировать — выделите текст и скопируйте вручную.
        </Text>
      )}
    </div>
  );
}

// «Новый API-ключ»: choose what it is for, create it, and make sure the one-time token is copied before the window goes away.
export function ApiKeyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [createApiKey, { isLoading }] = useCreateApiKeyMutation();
  const [name, setName] = useState('');
  const [boardsOnly, setBoardsOnly] = useState(false);
  const [expiry, setExpiry] = useState('never');
  // From the mutation's own response only — never in the store, so the plaintext lives in memory just as long as this dialog.
  const [created, setCreated] = useState<{ token: string; summary: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [warnUncopied, setWarnUncopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setName('');
    setBoardsOnly(false);
    setExpiry('never');
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
        scope: boardsOnly ? 'boards' : undefined,
        expiresInDays: expiry === 'never' ? undefined : (Number(expiry) as ApiKeyExpiryDays),
      }).unwrap();

      setCreated({ token: result.token, summary: describeNewKey(name.trim(), expiry, boardsOnly) });
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
            <div className={styles.dialogForm}>
            <Alert theme="warning" view="outlined" message="Скопируйте ключ сейчас: после закрытия окна показать его снова нельзя. Потерянный ключ можно только отозвать и создать новый." />
            <Text color="secondary" variant="caption-2">
              {created.summary}
            </Text>
            <CopyRow text={created.token} label="Скопировать ключ" strong onCopied={() => setCopied(true)} />
            <div className={styles.field}>
              <Text variant="body-2" color="secondary">
                Проверить, что ключ работает
              </Text>
              <CopyRow text={usageExample(API_URL, created.token)} label="Скопировать пример запроса" />
            </div>
            {warnUncopied && !copied && <Alert theme="danger" view="filled" message="Вы ещё не скопировали ключ. Если закрыть окно, он будет потерян. Нажмите ещё раз, чтобы закрыть без копирования." />}
            </div>
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
                      setBoardsOnly(preset.boards);
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
              <Select aria-label="Срок действия" value={[expiry]} onUpdate={([value]) => setExpiry(value ?? 'never')} options={EXPIRY_OPTIONS} width="max" />
              <Text color="secondary" variant="caption-2">
                {expiryHint(expiry)}
              </Text>
            </div>

            <div className={styles.field}>
              <Checkbox checked={boardsOnly} onUpdate={setBoardsOnly}>
                только для плат
              </Checkbox>
              <Text color="secondary" variant="caption-2">
                {BOARDS_ONLY_HINT}
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
