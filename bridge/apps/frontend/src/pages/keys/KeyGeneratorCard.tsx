import { useState } from 'react';
import { ArrowDownToLine, Eye, EyeSlash } from '@gravity-ui/icons';
import { Alert, Button, Card, Checkbox, ClipboardButton, Icon, Select, Text, TextInput } from '@gravity-ui/uikit';

import {
  DEFAULT_KEY_SIZE,
  generateRsaKeyPair,
  GeneratedKeyPair,
  KEY_SIZES,
  keyFileName,
  KeyKind,
  KeySize,
} from '../../shared/lib/keyGeneration';
import { triggerBlobDownload } from '../../shared/lib/parcelCrypto';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../KeysPage.module.css';

interface Result extends GeneratedKeyPair {
  name: string;
  savedInBrowser: boolean;
}

function download(pem: string, name: string, kind: KeyKind): void {
  triggerBlobDownload(new Blob([pem], { type: 'application/x-pem-file' }), keyFileName(name, kind));
}

export function KeyGeneratorCard({ addKeys }: { addKeys: (entries: { name: string; pem: string }[]) => void }) {
  const [name, setName] = useState('');
  const [size, setSize] = useState<KeySize>(DEFAULT_KEY_SIZE);
  const [saveInBrowser, setSaveInBrowser] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [showPrivate, setShowPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    const label = name.trim();

    if (!label) return;

    setIsGenerating(true);
    setError(null);
    setResult(null);
    setShowPrivate(false);

    try {
      const pair = await generateRsaKeyPair(size);

      if (saveInBrowser) {
        addKeys([
          { name: `${label} — приватный`, pem: pair.privateKey },
          { name: `${label} — публичный`, pem: pair.publicKey },
        ]);
      }

      setResult({ ...pair, name: label, savedInBrowser: saveInBrowser });
    } catch {
      setError('Не удалось сгенерировать ключи — этот браузер, возможно, не поддерживает Web Crypto.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader title="Сгенерировать пару ключей" />
      <Text color="secondary" variant="caption-2">
        Формат тот же, что у reports и sync (RSA-OAEP, публичный — SPKI, приватный — PKCS#8), поэтому пара подходит им всем.
        Публичным ключом шифруют посылку для получателя, приватным — открывают.
      </Text>

      <div className={styles.generateRow}>
        <TextInput
          label="Название"
          value={name}
          onUpdate={setName}
          placeholder="например, ноутбук"
          disabled={isGenerating}
        />
        <Select
          label="Длина"
          value={[String(size)]}
          onUpdate={([value]) => setSize(Number(value) as KeySize)}
          options={KEY_SIZES.map((bits) => ({
            value: String(bits),
            content: bits === DEFAULT_KEY_SIZE ? `${bits} бит (рекомендуется)` : `${bits} бит`,
          }))}
          disabled={isGenerating}
        />
        <Button view="action" size="m" loading={isGenerating} disabled={!name.trim()} onClick={() => void handleGenerate()}>
          Сгенерировать
        </Button>
      </div>

      <Checkbox checked={saveInBrowser} onUpdate={setSaveInBrowser} disabled={isGenerating} content="Сохранить в этом браузере (чтобы выбирать ключ по имени в Storage и Worker)" />

      {error && <Alert theme="danger" view="filled" message={error} />}

      {result && (
        <>
          <Alert
            theme="warning"
            view="filled"
            title="Скачайте приватный ключ сейчас"
            message={
              result.savedInBrowser
                ? 'Он хранится только в этом браузере и пропадёт при очистке данных сайта. На сервере его нет и восстановить его нельзя.'
                : 'Его нет нигде, кроме этой страницы: на сервере ключ не хранится и восстановить его нельзя.'
            }
          />

          <div className={styles.field}>
            <Text variant="body-2" color="secondary">Отпечаток публичного ключа (SHA-256)</Text>
            <Text variant="code-inline-2" className={styles.fingerprint}>{result.fingerprint}</Text>
          </div>

          <div className={styles.field}>
            <div className={styles.fieldHeader}>
              <Text variant="subheader-1">Публичный ключ</Text>
              <div className={styles.fieldActions}>
                <ClipboardButton text={result.publicKey} size="s" view="flat-secondary" tooltipInitialText="Скопировать" tooltipSuccessText="Скопировано" />
                <Button view="flat-secondary" size="s" aria-label="Скачать публичный ключ" onClick={() => download(result.publicKey, result.name, 'public')}>
                  <Icon data={ArrowDownToLine} size={16} />
                </Button>
              </div>
            </div>
            <textarea className={styles.pem} readOnly value={result.publicKey} aria-label="Публичный ключ" />
          </div>

          <div className={styles.field}>
            <div className={styles.fieldHeader}>
              <Text variant="subheader-1">Приватный ключ</Text>
              <div className={styles.fieldActions}>
                <Button view="flat-secondary" size="s" aria-label={showPrivate ? 'Скрыть приватный ключ' : 'Показать приватный ключ'} onClick={() => setShowPrivate((value) => !value)}>
                  <Icon data={showPrivate ? EyeSlash : Eye} size={16} />
                </Button>
                <ClipboardButton text={result.privateKey} size="s" view="flat-secondary" tooltipInitialText="Скопировать" tooltipSuccessText="Скопировано" />
                <Button view="flat-secondary" size="s" aria-label="Скачать приватный ключ" onClick={() => download(result.privateKey, result.name, 'private')}>
                  <Icon data={ArrowDownToLine} size={16} />
                </Button>
              </div>
            </div>
            <textarea
              className={`${styles.pem} ${showPrivate ? '' : styles.pemHidden}`}
              readOnly
              value={result.privateKey}
              aria-label="Приватный ключ"
            />
          </div>

          <Text color="secondary" variant="caption-2">
            Где использовать: публичный ключ — в reports (Settings → шифрование) и у отправителя посылок; приватный — здесь, в Storage и Worker, для открытия зашифрованных посылок.
          </Text>
        </>
      )}
    </Card>
  );
}
