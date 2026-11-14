import { Alert, Button, Card, Label, Skeleton, Text } from '@gravity-ui/uikit';
import { Link } from 'react-router-dom';

import { formatDateTime } from '../../shared/lib/formatRelativeTime';
import { describeApiError, useGetPromoOverviewQuery, useListPromoPostsQuery } from '../../store/api';
import styles from '../PromoPage.module.css';
import { CHANNEL_LABEL, channelSummary, needsAttention, STATUS_LABEL, STATUS_THEME, upcoming } from './promoLabels';

const POLL_MS = 60_000;

// The dashboard: where each channel stands, what goes out next, what needs the owner, and what the site is showing.
export function OverviewTab({ onOpenTab }: { onOpenTab: (tab: string) => void }) {
  const overview = useGetPromoOverviewQuery(undefined, { pollingInterval: POLL_MS, skipPollingIfUnfocused: true });
  const posts = useListPromoPostsQuery(undefined, { pollingInterval: POLL_MS, skipPollingIfUnfocused: true });

  if (overview.isLoading) return <Skeleton style={{ height: 160 }} />;

  if (overview.error || !overview.data) {
    return <Alert theme="danger" view="filled" title="Не удалось загрузить обзор" message={describeApiError(overview.error)} />;
  }

  const { channels, landing } = overview.data;
  const coming = upcoming(posts.data ?? []).slice(0, 5);
  const attention = needsAttention(posts.data ?? []);

  return (
    <div className={styles.stack}>
      {attention.length > 0 && (
        <Alert
          theme="warning"
          view="filled"
          title={`Требует внимания: ${attention.length}`}
          message={
            <ul className={styles.plainList}>
              {attention.map((post) => (
                <li key={post.id}>
                  {CHANNEL_LABEL[post.channel]} · {post.title}
                  {post.status === 'failed' ? ` — ошибка${post.error ? `: ${post.error}` : ''}` : ' — время прошло, а пост не вышел'}
                </li>
              ))}
            </ul>
          }
        />
      )}

      <div className={styles.grid}>
        {channels.map((channel) => (
          <Card key={channel.channel} view="outlined" className={styles.card}>
            <div className={styles.head}>
              <Text variant="subheader-2">{CHANNEL_LABEL[channel.channel]}</Text>
              <Label theme={channel.ready ? 'success' : 'warning'} size="s">
                {channel.ready ? 'готов' : 'не настроен'}
              </Label>
              <Label theme="normal" size="s">
                {channel.autoPublish ? 'автопубликация' : 'напоминания'}
              </Label>
            </div>
            <Text variant="body-1" color="secondary">
              {channel.note}
            </Text>
            <Text variant="body-1">{channelSummary(channel)}</Text>
            {channel.next ? (
              <Text variant="body-1" color="secondary">
                Следующий: «{channel.next.title}», {formatDateTime(channel.next.scheduledAt)}
              </Text>
            ) : (
              <Text variant="body-1" color="secondary">
                Ничего не запланировано
              </Text>
            )}
          </Card>
        ))}

        <Card view="outlined" className={styles.card}>
          <div className={styles.head}>
            <Text variant="subheader-2">Лендинг</Text>
            <Label theme={landing.configured && landing.activeDirName ? 'success' : 'warning'} size="s">
              {landing.configured ? (landing.activeDirName ? 'на сайте' : 'нет релиза') : 'не настроен'}
            </Label>
          </div>
          {landing.configured ? (
            <>
              <Text variant="body-1" color="secondary">
                Сейчас: {landing.activeDirName ?? '—'}; релизов в bridge: {landing.releases}
              </Text>
              <div className={styles.actions}>
                {landing.url && (
                  <Button view="outlined" size="m" href={landing.url} target="_blank" rel="noreferrer">
                    Открыть сайт
                  </Button>
                )}
                <Button view="flat" size="m" onClick={() => onOpenTab('landing')}>
                  Релизы
                </Button>
              </div>
            </>
          ) : (
            <Text variant="body-1" color="secondary">
              На этом bridge не задан LANDING_DIR (раздел работает на проде).
            </Text>
          )}
        </Card>
      </div>

      <Card view="outlined" className={styles.card}>
        <div className={styles.head}>
          <Text variant="subheader-2">Ближайшие публикации</Text>
          <Button view="flat" size="s" onClick={() => onOpenTab('posts')}>
            Все посты
          </Button>
        </div>
        {coming.length === 0 ? (
          <Text variant="body-1" color="secondary">
            Согласованных постов с датой нет. Создайте пост во вкладке «Посты», задайте время и согласуйте.
          </Text>
        ) : (
          <ul className={styles.plainList}>
            {coming.map((post) => (
              <li key={post.id} className={styles.row}>
                <Text variant="body-1">{formatDateTime(post.scheduledAt!)}</Text>
                <Label theme="normal" size="s">
                  {CHANNEL_LABEL[post.channel]}
                </Label>
                <Text variant="body-1">{post.title}</Text>
                <Label theme={STATUS_THEME[post.status]} size="s">
                  {STATUS_LABEL[post.status]}
                </Label>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Text variant="caption-2" color="secondary">
        Материалы для постов лежат в exp2/proto-450/promotion (telegram.md). <Link to="/dashboard">Дашборд инфраструктуры</Link>
      </Text>
    </div>
  );
}
