import { useRef, useState } from 'react';
import { Button, Icon, Switch, Text, useToaster } from '@gravity-ui/uikit';
import { ArrowDownToLine, ArrowUpFromLine, Eye, EyeSlash, MagicWand } from '@gravity-ui/icons';
import type { EncryptionSettingsType } from '@reports/shared';

import {
  useGetSubscriptionConfigQuery,
  useSetEncryptionSettingsMutation,
  useGenerateEncryptionKeyPairMutation,
} from '../../store/api';
import { describeError } from '../../utils/describe-error';

import style from './settings.module.css';

const emptyKeys = { publicKey: '', privateKey: '' };

function EncryptionSection() {
  const toaster = useToaster();
  const { data: config } = useGetSubscriptionConfigQuery();
  const [setEncryptionSettings, { isLoading: isSaving }] = useSetEncryptionSettingsMutation();
  const [generateEncryptionKeyPair, { isLoading: isGenerating }] = useGenerateEncryptionKeyPairMutation();

  const encryption = config?.encryption;
  const [keys, setKeys] = useState(emptyKeys);
  const [syncedKeys, setSyncedKeys] = useState(emptyKeys);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const persisted = encryption ? { publicKey: encryption.publicKey, privateKey: encryption.privateKey } : emptyKeys;

  if (encryption && JSON.stringify(persisted) !== JSON.stringify(syncedKeys)) {
    setSyncedKeys(persisted);
    setKeys(persisted);
  }

  const isDirty = JSON.stringify(keys) !== JSON.stringify(persisted);

  const notifyError = (title: string, error: unknown) => {
    toaster.add({ name: 'encryption-error', theme: 'danger', title, content: describeError(error), isClosable: true });
  };

  const handleToggle = async (enabled: boolean) => {
    if (!encryption) {
      return;
    }

    try {
      await setEncryptionSettings({ ...encryption, enabled }).unwrap();
    } catch (error) {
      notifyError('Не удалось изменить статус шифрования', error);
    }
  };

  const handleSaveKeys = async () => {
    if (!encryption) {
      return;
    }

    try {
      await setEncryptionSettings({ ...encryption, ...keys }).unwrap();
      toaster.add({ name: 'encryption-keys-saved', theme: 'success', title: 'Ключи сохранены', autoHiding: 3000 });
    } catch (error) {
      notifyError('Не удалось сохранить ключи', error);
    }
  };

  const handleGenerate = async () => {
    try {
      await generateEncryptionKeyPair().unwrap();
      toaster.add({ name: 'encryption-generated', theme: 'success', title: 'Новая пара ключей сгенерирована', autoHiding: 3000 });
    } catch (error) {
      notifyError('Не удалось сгенерировать пару ключей', error);
    }
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(keys, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = `subscription-encryption-keys-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as Partial<EncryptionSettingsType>;

      if (typeof parsed.publicKey !== 'string' || typeof parsed.privateKey !== 'string') {
        throw new Error('Файл должен содержать поля publicKey и privateKey');
      }

      setKeys({ publicKey: parsed.publicKey, privateKey: parsed.privateKey });
      toaster.add({
        name: 'encryption-import-loaded',
        theme: 'info',
        title: 'Ключи загружены в форму — нажмите «Сохранить ключи», чтобы применить',
        autoHiding: 5000,
      });
    } catch (error) {
      notifyError('Не удалось прочитать файл с ключами', error);
    }
  };

  return (
    <section className={style.codes}>
      <div className={style.sectionHead}>
        <Text variant="subheader-2">Шифрование посылок</Text>
        <Text variant="caption-2" color="secondary">
          Асимметричное шифрование (RSA + AES) поверх словаря — архив шифруется публичным ключом перед push
          и расшифровывается приватным при pull
        </Text>
      </div>

      <Switch
        checked={encryption?.enabled ?? false}
        onUpdate={handleToggle}
        disabled={!encryption || isSaving}
        content={encryption?.enabled ? 'Включено' : 'Выключено'}
      />

      {encryption?.enabled && !keys.publicKey && (
        <Text variant="body-2" color="danger">
          Шифрование включено, но пара ключей не задана — push завершится ошибкой, пока вы не сгенерируете ключи
        </Text>
      )}

      <div className={style.toolbar}>
        <Button view="outlined" size="s" onClick={handleGenerate} loading={isGenerating}>
          <Icon data={MagicWand} size={16} />
          Сгенерировать пару ключей
        </Button>
        <Button view="flat" size="s" disabled={!keys.publicKey && !keys.privateKey} onClick={handleExport}>
          <Icon data={ArrowDownToLine} size={16} />
          Экспорт
        </Button>
        <Button view="flat" size="s" onClick={() => fileInputRef.current?.click()}>
          <Icon data={ArrowUpFromLine} size={16} />
          Импорт
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];

            event.target.value = '';

            if (file) {
              void handleImportFile(file);
            }
          }}
        />
      </div>

      <div>
        <Text variant="body-short">Публичный ключ (для push)</Text>
        <textarea
          className={style.templateBody}
          value={keys.publicKey}
          onChange={(event) => setKeys((prev) => ({ ...prev, publicKey: event.target.value }))}
          placeholder="-----BEGIN PUBLIC KEY-----"
          spellCheck={false}
        />
      </div>

      <div>
        <div className={style.keyLabelRow}>
          <Text variant="body-short">Приватный ключ (для pull) — храните только локально</Text>
          <Button view="flat" size="s" onClick={() => setShowPrivateKey((prev) => !prev)} aria-label={showPrivateKey ? 'Скрыть' : 'Показать'}>
            <Icon data={showPrivateKey ? EyeSlash : Eye} size={16} />
          </Button>
        </div>
        <textarea
          className={`${style.templateBody} ${showPrivateKey ? '' : style.blurred}`}
          value={keys.privateKey}
          onChange={(event) => setKeys((prev) => ({ ...prev, privateKey: event.target.value }))}
          placeholder="-----BEGIN PRIVATE KEY-----"
          spellCheck={false}
        />
      </div>

      {isDirty && (
        <div className={style.formActions}>
          <Button view="action" size="m" onClick={handleSaveKeys} loading={isSaving}>
            Сохранить ключи
          </Button>
          <Button view="flat" size="m" onClick={() => setKeys(persisted)}>
            Отменить
          </Button>
        </div>
      )}

      <Text variant="caption-2" color="secondary">
        Для pull на другой машине нужна та же пара ключей — перенесите её через Экспорт/Импорт
      </Text>
    </section>
  )
}

export default EncryptionSection;
