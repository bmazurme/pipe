import { useState } from 'react';
import { ArrowsRotateRight, Key, Plus, TrashBin } from '@gravity-ui/icons';
import {
  ActionTooltip,
  Alert,
  Button,
  Card,
  ClipboardButton,
  Icon,
  Skeleton,
  Text,
} from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { EmptyState } from '../../widgets/EmptyState';
import { SectionHeader } from '../../widgets/SectionHeader';
import {
  API_URL,
  ApiKey,
  useListApiKeysQuery,
  useRevokeApiKeyMutation,
} from '../../store/api';
import { useAppSelector } from '../../store/hooks';
import { apiKeysSelector } from '../../store/slices';
import styles from './ProfilePage.module.css';
import { ApiKeyDialog } from './ApiKeyDialog';
import { describeScope, idleDays, STALE_AFTER_DAYS } from './apiKeyDialogUtils';
import { RotateKeyDialog } from './RotateKeyDialog';

function describeExpiry(expiresAt: string | null | undefined): string {
  if (!expiresAt) return '';
  const date = new Date(expiresAt);
  if (date.getTime() <= Date.now()) return 'истёк · ';
  return `действует до ${date.toLocaleDateString('ru-RU')} · `;
}

const SKELETON_ROWS = [0, 1, 2];
const USAGE_EXAMPLE = `curl -H "X-Api-Key: brk_…" ${API_URL}/api/v1/worker/status`;

export function ApiKeysSection() {
  const { isLoading, isError } = useListApiKeysQuery();
  const apiKeys = useAppSelector(apiKeysSelector);
  const [revokeApiKey] = useRevokeApiKeyMutation();

  const [revokingId, setRevokingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [rotating, setRotating] = useState<ApiKey | null>(null);

  const handleRevoke = async (apiKey: ApiKey) => {
    setError(null);
    setRevokingId(apiKey.id);

    try {
      await revokeApiKey(apiKey.id).unwrap();
    } catch {
      setError('Не удалось отозвать ключ');
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <Card view="outlined" className={styles.card}>
      <div className={styles.form}>
        <SectionHeader
          title="API-ключи"
          meta={apiKeys.length > 0 ? String(apiKeys.length) : undefined}
          actions={
            <Button view="normal" size="s" onClick={() => setIsCreateOpen(true)}>
              <Icon data={Plus} size={16} />
              Создать
            </Button>
          }
        />

        <Text color="secondary" variant="caption-2">
          Единственный способ подключить интеграцию — sync-cli, reports, worker,
          ntlstl.time, свои скрипты. Ключ живёт 90 дней, если не выбрать другое (бессрочный — осознанный выбор), и может быть ограничен: только чтение, только reports или только платы; в запросе его
          передают заголовком <code>X-Api-Key</code>.
        </Text>

        <div className={styles.endpointRow}>
          <Text variant="code-inline-2" ellipsis title={USAGE_EXAMPLE}>
            {USAGE_EXAMPLE}
          </Text>
          <ClipboardButton
            text={USAGE_EXAMPLE}
            size="xs"
            view="flat-secondary"
            tooltipInitialText="Скопировать пример"
            tooltipSuccessText="Скопировано"
          />
        </div>

        {isLoading && (
          <ul className={styles.deviceList}>
            {SKELETON_ROWS.map((row) => (
              <li key={row} className={styles.deviceRow}>
                <Skeleton variant="circle" width={32} height={32} className={styles.deviceIconSkeleton} />
                <div className={styles.deviceInfo}>
                  <Skeleton width="60%" height={16} />
                  <Skeleton width="40%" height={12} />
                </div>
              </li>
            ))}
          </ul>
        )}

        {(error || isError) && (
          <Alert theme="danger" view="filled" message={error ?? 'Не удалось загрузить список ключей'} />
        )}

        {!isLoading && !isError && apiKeys.length === 0 && (
          <EmptyState icon={Key} title="Ключей ещё нет" />
        )}

        {!isLoading && apiKeys.length > 0 && (
          <ul className={styles.deviceList}>
            {apiKeys.map((apiKey) => (
              <li key={apiKey.id} className={styles.deviceRow}>
                <span className={styles.deviceIcon}>
                  <Icon data={Key} size={16} />
                </span>

                <div className={styles.deviceInfo}>
                  <Text ellipsis title={apiKey.name}>
                    {apiKey.name}
                  </Text>
                  <Text color="secondary" variant="caption-2" ellipsis>
                    {apiKey.prefix}… · {describeExpiry(apiKey.expiresAt)}{apiKey.scope ? `${describeScope(apiKey.scope)} · ` : ''}{apiKey.lastUsedAt
                      ? `использован ${formatRelativeTime(apiKey.lastUsedAt)}`
                      : 'ещё не использован'}
                  </Text>
                  {idleDays(apiKey.lastUsedAt, apiKey.createdAt) >= STALE_AFTER_DAYS && (
                    <Text color="warning" variant="caption-2">
                      Не использовался {idleDays(apiKey.lastUsedAt, apiKey.createdAt)} дн. — отзовите, если не нужен.
                    </Text>
                  )}
                </div>

                <ActionTooltip title="Перевыпустить: тот же ключ с новым секретом">
                  <Button
                    view="flat"
                    aria-label={`Перевыпустить ключ: ${apiKey.name}`}
                    disabled={revokingId !== null}
                    onClick={() => setRotating(apiKey)}
                  >
                    <Icon data={ArrowsRotateRight} size={16} />
                  </Button>
                </ActionTooltip>

                <ActionTooltip title="Отозвать ключ">
                  <Button
                    view="flat-danger"
                    aria-label={`Отозвать ключ: ${apiKey.name}`}
                    disabled={revokingId !== null && revokingId !== apiKey.id}
                    loading={revokingId === apiKey.id}
                    onClick={() => void handleRevoke(apiKey)}
                  >
                    <Icon data={TrashBin} size={16} />
                  </Button>
                </ActionTooltip>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ApiKeyDialog open={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
      <RotateKeyDialog apiKey={rotating} onClose={() => setRotating(null)} />
    </Card>
  );
}
