import { useState } from 'react';
import { Copy, Key, Plus, TrashBin } from '@gravity-ui/icons';
import {
  ActionTooltip,
  Alert,
  Button,
  Card,
  ClipboardButton,
  Dialog,
  Icon,
  Skeleton,
  Text,
  TextInput,
} from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { EmptyState } from '../../widgets/EmptyState';
import { SectionHeader } from '../../widgets/SectionHeader';
import {
  API_URL,
  ApiKey,
  useCreateApiKeyMutation,
  useListApiKeysQuery,
  useRevokeApiKeyMutation,
} from '../../store/api';
import { useAppSelector } from '../../store/hooks';
import { apiKeysSelector } from '../../store/slices';
import styles from '../ProfilePage.module.css';

const SKELETON_ROWS = [0, 1, 2];
const USAGE_EXAMPLE = `curl -H "X-Api-Key: brk_…" ${API_URL}/api/v1/worker/status`;

export function ApiKeysSection() {
  const { isLoading, isError } = useListApiKeysQuery();
  const apiKeys = useAppSelector(apiKeysSelector);
  const [createApiKey, { isLoading: isCreating }] = useCreateApiKeyMutation();
  const [revokeApiKey] = useRevokeApiKeyMutation();

  const [revokingId, setRevokingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [name, setName] = useState('');
  // Set only right after creation, from the mutation's own response — never
  // persisted to the store, so the plaintext token exists in memory only
  // for as long as this dialog stays open.
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleOpenCreate = () => {
    setName('');
    setCreatedToken(null);
    setCreateError(null);
    setIsCreateOpen(true);
  };

  const handleCloseCreate = () => {
    setIsCreateOpen(false);
    setCreatedToken(null);
  };

  const handleCreate = async () => {
    if (!name.trim()) return;

    setCreateError(null);

    try {
      const created = await createApiKey(name.trim()).unwrap();
      setCreatedToken(created.token);
    } catch {
      setCreateError('Не удалось создать ключ');
    }
  };

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
            <Button view="normal" size="s" onClick={handleOpenCreate}>
              <Icon data={Plus} size={16} />
              Создать
            </Button>
          }
        />

        <Text color="secondary" variant="caption-2">
          Единственный способ подключить интеграцию — sync-cli, reports, worker,
          ntlstl.time, свои скрипты. Ключ действует до отзыва; в запросе его
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
                    {apiKey.prefix}… · {apiKey.lastUsedAt
                      ? `использован ${formatRelativeTime(apiKey.lastUsedAt)}`
                      : 'ещё не использован'}
                  </Text>
                </div>

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

      <Dialog open={isCreateOpen} onClose={handleCloseCreate} maxWidth="s" aria-labelledby="create-api-key-title">
        {createdToken ? (
          <>
            <Dialog.Header caption="Ключ создан" id="create-api-key-title" />
            <Dialog.Body>
              <Text color="secondary">
                Скопируйте ключ сейчас — второй раз он не будет показан.
              </Text>
              <div className={styles.endpointRow}>
                <Text variant="code-inline-2" ellipsis title={createdToken}>
                  {createdToken}
                </Text>
                <ClipboardButton
                  text={createdToken}
                  size="xs"
                  view="flat-secondary"
                  tooltipInitialText="Скопировать ключ"
                  tooltipSuccessText="Скопировано"
                >
                  <Icon data={Copy} size={14} />
                </ClipboardButton>
              </div>
            </Dialog.Body>
            <Dialog.Footer textButtonApply="Готово" onClickButtonApply={handleCloseCreate} />
          </>
        ) : (
          <>
            <Dialog.Header caption="Новый API-ключ" id="create-api-key-title" />
            <Dialog.Body>
              <label className={styles.field}>
                <Text variant="body-2" color="secondary">
                  Название
                </Text>
                <TextInput
                  value={name}
                  onUpdate={setName}
                  placeholder="sync-cli на ноутбуке"
                  autoFocus
                  hasClear
                />
              </label>
              {createError && <Alert theme="danger" view="filled" message={createError} />}
            </Dialog.Body>
            <Dialog.Footer
              textButtonCancel="Отмена"
              textButtonApply="Создать"
              loading={isCreating}
              propsButtonApply={{ disabled: !name.trim() }}
              onClickButtonCancel={handleCloseCreate}
              onClickButtonApply={() => void handleCreate()}
            />
          </>
        )}
      </Dialog>
    </Card>
  );
}
