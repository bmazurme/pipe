import { useState } from 'react';
import { Check, Copy } from '@gravity-ui/icons';
import { Alert, Button, Icon, Text } from '@gravity-ui/uikit';

import { API_URL } from '../../store/api';
import styles from './ProfilePage.module.css';
import { usageExample } from './apiKeyDialogUtils';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);

    return true;
  } catch {
    return false;
  }
}

// A token and a button that says plainly whether it was copied. Select-all on click is the fallback when the clipboard is refused.
export function CopyRow({ text, label, onCopied, strong = false }: { text: string; label: string; onCopied?: () => void; strong?: boolean }) {
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

// What is shown once a key exists: the one-time token, the line that says which key it is, a request to test it with — and, when the owner starts
// to close without having copied it, the second warning. The dialog owns `copied` and `warnUncopied`, because it owns closing.
export function KeyTokenView({
  token,
  summary,
  copied,
  warnUncopied,
  onCopied,
  note,
}: {
  token: string;
  summary: string;
  copied: boolean;
  warnUncopied: boolean;
  onCopied: () => void;
  note?: string;
}) {
  return (
    <div className={styles.dialogForm}>
      <Alert theme="warning" view="outlined" message="Скопируйте ключ сейчас: после закрытия окна показать его снова нельзя. Потерянный ключ можно только отозвать и создать новый." />
      {note && <Alert theme="success" view="outlined" message={note} />}
      <Text color="secondary" variant="caption-2">
        {summary}
      </Text>
      <CopyRow text={token} label="Скопировать ключ" strong onCopied={onCopied} />
      <div className={styles.field}>
        <Text variant="body-2" color="secondary">
          Проверить, что ключ работает
        </Text>
        <CopyRow text={usageExample(API_URL, token)} label="Скопировать пример запроса" />
      </div>
      {warnUncopied && !copied && <Alert theme="danger" view="filled" message="Вы ещё не скопировали ключ. Если закрыть окно, он будет потерян. Нажмите ещё раз, чтобы закрыть без копирования." />}
    </div>
  );
}
