import { useEffect, useState } from 'react';
import { Pencil } from '@gravity-ui/icons';
import { Alert, Button, Card, Icon, Label, SegmentedRadioGroup, Skeleton, Text, TextInput } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import {
  API_URL,
  type CreatedVpnProfile,
  useCreateVpnProfileMutation,
  useListVpnProfilesQuery,
  useRenameVpnProfileMutation,
  useRevokeVpnProfileMutation,
  type VpnProfile,
  type VpnProfileAudience,
} from '../../store/api';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../VpnPage.module.css';

// The server refuses more (the same limit as when a device is made).
const LABEL_MAX = 100;

const AUDIENCE_LABEL: Record<VpnProfileAudience, string> = { phone: 'Телефон', laptop: 'Ноутбук', server: 'Сервер' };
// How long the armed "revoke" button waits for its confirming second click.
const CONFIRM_MS = 4000;

const subscriptionUrl = (path: string) => `${API_URL.replace(/\/$/, '')}${path}`;

// The device's name, as text with a pencil; while it is being edited, a field with Save and Cancel (Enter saves, Esc cancels). Only the
// name changes — the link the device already has keeps working, which is why this is safe to do on a device in use.
function ProfileName({ profile }: { profile: VpnProfile }) {
  const [rename, { isLoading }] = useRenameVpnProfileMutation();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(profile.label);
  const [error, setError] = useState<string | null>(null);
  const trimmed = value.trim();

  const open = () => {
    setValue(profile.label);
    setError(null);
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setError(null);
  };

  const save = async () => {
    if (!trimmed || isLoading) return;

    if (trimmed === profile.label) {
      cancel();
      return;
    }

    setError(null);

    try {
      await rename({ id: profile.id, label: trimmed }).unwrap();
      setEditing(false);
    } catch {
      // The field stays open with what was typed: a failed save must not cost the name that was just thought of.
      setError('Не удалось переименовать');
    }
  };

  if (!editing) {
    return (
      <>
        <Text variant="body-2">{profile.label}</Text>
        <Button view="flat-secondary" size="xs" aria-label={`Переименовать: ${profile.label}`} title="Переименовать" onClick={open}>
          <Icon data={Pencil} size={14} />
        </Button>
      </>
    );
  }

  return (
    <span className={styles.renameRow}>
      <TextInput
        autoFocus
        size="s"
        value={value}
        onUpdate={setValue}
        validationState={!trimmed || value.length > LABEL_MAX ? 'invalid' : undefined}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void save();
          if (event.key === 'Escape') cancel();
        }}
        controlProps={{ 'aria-label': `Новое имя устройства ${profile.label}`, maxLength: LABEL_MAX }}
      />
      <Button view="action" size="s" loading={isLoading} disabled={!trimmed} onClick={() => void save()}>
        Сохранить
      </Button>
      <Button view="flat" size="s" disabled={isLoading} onClick={cancel}>
        Отмена
      </Button>
      {error && (
        <Text color="danger" variant="caption-2" role="alert">
          {error}
        </Text>
      )}
    </span>
  );
}

function ProfileRow({ profile }: { profile: VpnProfile }) {
  const [revoke, { isLoading }] = useRevokeVpnProfileMutation();
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // An armed button disarms itself, so a stray earlier click cannot turn a later one into a revoke.
  useEffect(() => {
    if (!armed) return undefined;

    const timer = setTimeout(() => setArmed(false), CONFIRM_MS);

    return () => clearTimeout(timer);
  }, [armed]);

  const handleRevoke = async () => {
    if (!armed) {
      setArmed(true);
      return;
    }

    setArmed(false);
    setError(null);

    try {
      await revoke(profile.id).unwrap();
    } catch {
      setError('Не удалось отозвать ссылку');
    }
  };

  return (
    <li className={styles.connectionRow}>
      <div className={styles.connectionHeader}>
        <div className={styles.connectionTitle}>
          <ProfileName profile={profile} />
          <Label size="xs" theme="info">
            {AUDIENCE_LABEL[profile.audience]}
          </Label>
          {profile.revokedAt && (
            <Label size="xs" theme="danger">
              отозвана
            </Label>
          )}
          <Text color="secondary" variant="caption-2">
            {profile.tokenPrefix}…
          </Text>
          <Text color="secondary" variant="caption-2">
            {profile.lastUsedAt ? `последний запрос ${formatRelativeTime(profile.lastUsedAt)}` : 'ещё не запрашивалась'}
          </Text>
        </div>
        {!profile.revokedAt && (
          <div className={styles.connectionActions}>
            <Button
              view={armed ? 'outlined-danger' : 'flat-danger'}
              size="s"
              loading={isLoading}
              title={armed ? 'Нажмите ещё раз для подтверждения' : undefined}
              aria-label={armed ? `Подтвердить отзыв ссылки: ${profile.label}` : `Отозвать ссылку: ${profile.label}`}
              onClick={() => void handleRevoke()}
            >
              {armed ? 'Отозвать?' : 'Отозвать'}
            </Button>
          </div>
        )}
      </div>
      {error && (
        <Text color="danger" variant="caption-2" role="alert">
          {error}
        </Text>
      )}
    </li>
  );
}

// A link per device for the VPN clients on phones and laptops (Hiddify, v2rayN, v2rayNG, sing-box: "add a subscription"). They get the
// links of every connection here and pick the one that works on their own, so a blocked server costs them seconds, not a visit to this page.
export function VpnProfilesCard() {
  const { data: profiles, isLoading, isError } = useListVpnProfilesQuery();
  const [createProfile, { isLoading: isCreating }] = useCreateVpnProfileMutation();
  const [label, setLabel] = useState('');
  const [audience, setAudience] = useState<VpnProfileAudience>('phone');
  const [created, setCreated] = useState<CreatedVpnProfile | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!label.trim()) return;

    setError(null);
    setCopied(false);

    try {
      setCreated(await createProfile({ label: label.trim(), audience }).unwrap());
      setLabel('');
    } catch {
      setError('Не удалось создать ссылку');
    }
  };

  const handleCopy = async () => {
    if (!created) return;

    try {
      await navigator.clipboard.writeText(subscriptionUrl(created.path));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader title="Профили устройств" />
      <Text color="secondary" variant="caption-2">
        Для телефона и ноутбука: клиент (Hiddify, v2rayN, v2rayNG, sing-box) получает по ссылке список всех подключений и сам выбирает
        рабочее. У каждого устройства своя ссылка — потерянное отзывается отдельно. Ссылка даёт доступ к серверам и ключам, храните её как
        пароль: она показывается один раз, при создании.
      </Text>

      {created && (
        <Alert
          theme="success"
          view="filled"
          title={`Ссылка для «${created.label}» — сохраните её сейчас, больше она не показывается`}
          message={
            <div className={styles.secretRow}>
              <TextInput
                value={subscriptionUrl(created.path)}
                readOnly
                controlProps={{ 'aria-label': `Ссылка профиля ${created.label}` }}
              />
              <Button view="normal" size="s" onClick={() => void handleCopy()}>
                {copied ? 'Скопировано' : 'Скопировать'}
              </Button>
            </div>
          }
        />
      )}

      {isLoading && <Skeleton height={40} />}
      {isError && <Alert theme="danger" view="filled" message="Не удалось получить список профилей" />}

      {profiles && profiles.length > 0 && (
        <ul className={styles.connectionList}>
          {profiles.map((profile) => (
            <ProfileRow key={profile.id} profile={profile} />
          ))}
        </ul>
      )}
      {profiles && profiles.length === 0 && (
        <Text color="secondary" variant="body-2">
          Ссылок ещё нет — создайте первую ниже.
        </Text>
      )}

      <div className={styles.provisionGrid}>
        <label className={styles.secretField}>
          <Text variant="body-2" color="secondary">
            Устройство
          </Text>
          <TextInput value={label} onUpdate={setLabel} placeholder="Например, iPhone" />
        </label>
        <div className={styles.secretField}>
          <Text variant="body-2" color="secondary">
            Тип
          </Text>
          <SegmentedRadioGroup value={audience} onUpdate={(value) => setAudience(value as VpnProfileAudience)} aria-label="Тип устройства">
            <SegmentedRadioGroup.Option value="phone">Телефон</SegmentedRadioGroup.Option>
            <SegmentedRadioGroup.Option value="laptop">Ноутбук</SegmentedRadioGroup.Option>
            <SegmentedRadioGroup.Option value="server">Сервер</SegmentedRadioGroup.Option>
          </SegmentedRadioGroup>
        </div>
      </div>
      <div className={styles.connectionActions}>
        <Button view="action" loading={isCreating} disabled={!label.trim()} onClick={() => void handleCreate()}>
          Создать ссылку
        </Button>
      </div>
      {error && <Alert theme="danger" view="filled" message={error} />}
    </Card>
  );
}
