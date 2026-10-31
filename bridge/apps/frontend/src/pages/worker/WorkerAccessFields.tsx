import { useState } from 'react';
import { Button, Select, Text, TextInput } from '@gravity-ui/uikit';

import { useListClaudeCredentialsQuery, useListVpnConnectionsQuery } from '../../store/api';
import styles from '../WorkerPage.module.css';

// Select values are strings; this one is "no token set for the worker".
export const DEFAULT_TOKEN = '';

interface ClaudeTokenFieldProps {
  /** '' = the account's first token. */
  value: string;
  onChange: (value: string) => void;
}

// Which stored Claude token the worker runs Sonnet/Opus/Haiku with — chosen here, never in the worker's environment.
export function ClaudeTokenField({ value, onChange }: ClaudeTokenFieldProps) {
  const { data: credentials } = useListClaudeCredentialsQuery();

  return (
    <label className={styles.dialogForm}>
      <Text variant="body-2" color="secondary">
        Claude-токен этого worker&apos;а
      </Text>
      <Select
        value={[value]}
        onUpdate={(next) => onChange(next[0] ?? DEFAULT_TOKEN)}
        options={[
          { value: DEFAULT_TOKEN, content: 'Первый из списка токенов' },
          ...(Array.isArray(credentials) ? credentials : []).map((credential) => ({
            value: String(credential.id),
            content: credential.name,
          })),
        ]}
        width="max"
        aria-label="Claude-токен worker'а"
      />
      <Text variant="caption-2" color="secondary">
        Для задач и чата на Sonnet/Opus/Haiku, если в задаче токен не выбран явно. Токены добавляются на странице Worker →
        «Ключи».
      </Text>
    </label>
  );
}

export function isVlessLink(value: string): boolean {
  return /^vless:\/\/\S+$/.test(value.trim());
}

interface VpnLinkFieldProps {
  /** host:port of the VPN already set for this worker, or null. */
  currentHost: string | null;
  /**
   * What to send on save: undefined = leave as it is, null = remove, a string = the new link.
   */
  onChange: (change: string | null | undefined) => void;
}

// The worker's own VPN: a vless:// Reality link. It is a secret, so it is write-only — once saved only the server's host
// is shown, and it can be replaced or removed, never read back.
export function VpnLinkField({ currentHost, onChange }: VpnLinkFieldProps) {
  const [mode, setMode] = useState<'keep' | 'replace' | 'remove'>('keep');
  const [link, setLink] = useState('');
  const showInput = currentHost === null || mode === 'replace';
  const invalid = link.trim() !== '' && !isVlessLink(link);

  const choose = (next: 'keep' | 'replace' | 'remove') => {
    setMode(next);
    setLink('');
    onChange(next === 'remove' ? null : undefined);
  };

  return (
    <div className={styles.dialogForm}>
      <Text variant="body-2" color="secondary">
        VPN этого worker&apos;а (необязательно)
      </Text>

      {currentHost !== null && mode !== 'replace' && (
        <div className={styles.fieldRow}>
          <Text variant="body-2">{mode === 'remove' ? 'VPN будет удалён' : `Настроен: ${currentHost}`}</Text>
          {mode === 'remove' ? (
            <Button size="s" view="flat" onClick={() => choose('keep')}>
              Не удалять
            </Button>
          ) : (
            <>
              <Button size="s" view="outlined" onClick={() => choose('replace')}>
                Заменить
              </Button>
              <Button size="s" view="flat-danger" onClick={() => choose('remove')}>
                Убрать
              </Button>
            </>
          )}
        </div>
      )}

      {showInput && (
        <>
          <TextInput
            type="password"
            value={link}
            onUpdate={(value) => {
              setLink(value);
              onChange(value.trim() === '' ? undefined : value.trim());
            }}
            placeholder="vless://UUID@сервер:порт?security=reality&…"
            hasClear
            validationState={invalid ? 'invalid' : undefined}
            errorMessage={invalid ? 'Нужна ссылка vless://… (Reality)' : undefined}
            controlProps={{ 'aria-label': "VPN-ссылка worker'а" }}
          />
          {mode === 'replace' && (
            <Button size="s" view="flat" onClick={() => choose('keep')}>
              Оставить прежний
            </Button>
          )}
        </>
      )}

      <Text variant="caption-2" color="secondary">
        Ссылка vless:// (Reality) из панели VPN или приложения. Worker сам поднимает с ней туннель и ходит к Claude и AI
        через него — отдельный VPN-контейнер рядом не нужен. Ссылка хранится зашифрованной и больше не показывается;
        применяется за один интервал опроса.
      </Text>
    </div>
  );
}

export type VpnSource = 'link' | 'connection' | 'active';

const VPN_SOURCE_OPTIONS: { value: VpnSource; content: string }[] = [
  { value: 'link', content: 'Своя ссылка vless://' },
  { value: 'connection', content: 'Подключение со страницы VPN' },
  { value: 'active', content: 'Активное подключение со страницы VPN' },
];

interface VpnSourceFieldProps {
  source: VpnSource;
  connectionId: number | null;
  onChange: (source: VpnSource, connectionId: number | null) => void;
}

// Where the worker's tunnel comes from: a link of its own (VpnLinkField below it), a specific connection of the VPN page, or whichever
// one is active there — switching the active connection then moves the worker too, with nothing to paste.
export function VpnSourceField({ source, connectionId, onChange }: VpnSourceFieldProps) {
  const { data: connections, isError } = useListVpnConnectionsQuery();
  const list = Array.isArray(connections) ? connections : [];
  const active = list.find((connection) => connection.isActive);

  return (
    <div className={styles.dialogForm}>
      <Text variant="body-2" color="secondary">
        Откуда VPN этого worker&apos;а
      </Text>
      <Select
        value={[source]}
        onUpdate={(next) => {
          const value = (next[0] ?? 'link') as VpnSource;

          onChange(value, value === 'connection' ? (connectionId ?? list[0]?.id ?? null) : null);
        }}
        options={VPN_SOURCE_OPTIONS}
        width="max"
        aria-label="Источник VPN"
      />

      {source === 'connection' && (
        <Select
          placeholder="Подключение"
          value={connectionId === null ? [] : [String(connectionId)]}
          onUpdate={(next) => onChange('connection', next[0] ? Number(next[0]) : null)}
          options={list.map((connection) => ({
            value: String(connection.id),
            content: `${connection.name} · ${connection.serverAddress}${connection.isActive ? ' · активное' : ''}`,
          }))}
          width="max"
          validationState={connectionId === null ? 'invalid' : undefined}
          aria-label="Подключение VPN"
        />
      )}

      {source === 'active' && (
        <Text variant="caption-2" color="secondary">
          {active ? `Сейчас активно: ${active.name} · ${active.serverAddress}.` : 'Сейчас активного подключения нет — worker будет без VPN.'}
        </Text>
      )}

      {source !== 'link' && (
        <Text variant="caption-2" color="secondary">
          Ссылку bridge собирает из панели этого подключения и отдаёт только этому worker&apos;у; если панель недоступна, worker продолжает с последней
          рабочей ссылкой. Подключения добавляются на странице VPN.
        </Text>
      )}
      {isError && (
        <Text color="danger" variant="caption-2">
          Не удалось получить список подключений VPN.
        </Text>
      )}
    </div>
  );
}
