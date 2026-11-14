import { useState } from 'react';
import { Alert, Button, Card, Label, Select, Skeleton, Text, TextInput } from '@gravity-ui/uikit';
import { Plus } from '@gravity-ui/icons';

import { formatDateTime } from '../../shared/lib/formatRelativeTime';
import { Dialog } from '../../shared/ui/Dialog';
import {
  describeApiError,
  type PromoChannel,
  type PromoPost,
  useApprovePromoPostMutation,
  useDeletePromoPostMutation,
  useListPromoAssetsQuery,
  useListPromoPostsQuery,
  useMarkPromoPostPublishedMutation,
  usePublishPromoPostNowMutation,
  useTestPromoPostMutation,
  useUnapprovePromoPostMutation,
} from '../../store/api';
import { EmptyState } from '../../widgets/EmptyState';
import styles from '../PromoPage.module.css';
import { PostDialog } from './PostDialog';
import { CHANNEL_LABEL, CHANNELS, MODE_LABEL, STATUS_LABEL, STATUS_THEME } from './promoLabels';

type Editing = PromoPost | 'new' | null;

export function PostsTab() {
  const posts = useListPromoPostsQuery();
  const assets = useListPromoAssetsQuery();
  const [approve] = useApprovePromoPostMutation();
  const [unapprove] = useUnapprovePromoPostMutation();
  const [markPublished] = useMarkPromoPostPublishedMutation();
  const [remove] = useDeletePromoPostMutation();
  const [publishNow] = usePublishPromoPostNowMutation();
  const [sendTest] = useTestPromoPostMutation();
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<PromoChannel | 'all'>('all');
  const [editing, setEditing] = useState<Editing>(null);
  const [closing, setClosing] = useState<PromoPost | null>(null);
  const [link, setLink] = useState('');
  const [deleting, setDeleting] = useState<PromoPost | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    setNotice(null);

    try {
      await action();
    } catch (err) {
      setError(describeApiError(err));
    }
  };

  if (posts.isLoading) return <Skeleton style={{ height: 160 }} />;

  if (posts.error || !posts.data) {
    return <Alert theme="danger" view="filled" title="Не удалось загрузить посты" message={describeApiError(posts.error)} />;
  }

  const shown = posts.data.filter((post) => filter === 'all' || post.channel === filter);

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <Select
          size="m"
          label="Канал:"
          value={[filter]}
          onUpdate={([value]) => setFilter(value as PromoChannel | 'all')}
          options={[{ value: 'all', content: 'Все' }, ...CHANNELS.map((value) => ({ value, content: CHANNEL_LABEL[value] }))]}
        />
        <Button view="action" size="m" onClick={() => setEditing('new')}>
          <Button.Icon>
            <Plus />
          </Button.Icon>
          Новый пост
        </Button>
      </div>

      {error && <Alert theme="danger" view="filled" message={error} onClose={() => setError(null)} />}
      {notice && <Alert theme="success" view="filled" message={notice} onClose={() => setNotice(null)} />}

      {shown.length === 0 ? (
        <EmptyState
          icon={Plus}
          title="Постов нет"
          description="Готовые тексты лежат в telegram.md рядом с лендингом: создайте пост и вставьте текст."
        />
      ) : (
        shown.map((post) => {
          const frozen = post.status === 'published' || post.status === 'reminded' || post.status === 'publishing';

          return (
            <Card key={post.id} view="outlined" className={styles.card}>
              <div className={styles.head}>
                <Text variant="subheader-2">{post.title}</Text>
                <Label theme="normal" size="s">
                  {CHANNEL_LABEL[post.channel]}
                </Label>
                <Label theme={STATUS_THEME[post.status]} size="s">
                  {STATUS_LABEL[post.status]}
                </Label>
                <Label theme="normal" size="s">
                  {MODE_LABEL[post.mode]}
                </Label>
              </div>
              <Text variant="body-1" color="secondary">
                {post.scheduledAt ? `Выложить: ${formatDateTime(post.scheduledAt)}` : 'Без даты'} · {post.captionLength} / {post.captionLimit} знаков · файлов:{' '}
                {post.assetIds.length}
                {post.externalUrl && (
                  <>
                    {' '}
                    · <a href={post.externalUrl} target="_blank" rel="noreferrer">ссылка</a>
                  </>
                )}
              </Text>
              {post.error && <Alert theme="danger" view="filled" message={post.error} />}
              <div className={styles.actions}>
                {!frozen && (
                  <Button view="outlined" size="m" onClick={() => setEditing(post)}>
                    Редактировать
                  </Button>
                )}
                {(post.status === 'draft' || post.status === 'failed') && (
                  <Button view="action" size="m" onClick={() => void run(() => approve(post.id).unwrap())}>
                    Согласовать
                  </Button>
                )}
                {post.channel === 'telegram' && post.status === 'approved' && (
                  <Button view="action" size="m" onClick={() => void run(() => publishNow(post.id).unwrap())}>
                    Опубликовать сейчас
                  </Button>
                )}
                {post.channel === 'telegram' && !frozen && (
                  <Button
                    view="outlined"
                    size="m"
                    onClick={() => void run(async () => {
                      await sendTest(post.id).unwrap();
                      setNotice('Тест отправлен вам в личный чат с ботом.');
                    })}
                  >
                    Тест мне
                  </Button>
                )}
                {post.status === 'approved' && (
                  <Button view="outlined" size="m" onClick={() => void run(() => unapprove(post.id).unwrap())}>
                    В черновики
                  </Button>
                )}
                {!frozen && (
                  <Button
                    view="flat"
                    size="m"
                    onClick={() => {
                      setLink('');
                      setClosing(post);
                    }}
                  >
                    Отметить опубликованным
                  </Button>
                )}
                <Button view="flat-danger" size="m" onClick={() => setDeleting(post)}>
                  Удалить
                </Button>
              </div>
            </Card>
          );
        })
      )}

      {editing && <PostDialog post={editing === 'new' ? null : editing} assets={assets.data ?? []} onClose={() => setEditing(null)} />}

      <Dialog open={Boolean(closing)} onClose={() => setClosing(null)} maxWidth="s" aria-labelledby="promo-publish-title">
        <Dialog.Header caption="Пост опубликован" id="promo-publish-title" />
        <Dialog.Body>
          <TextInput size="m" placeholder="Ссылка на пост (необязательно)" value={link} controlProps={{ 'aria-label': 'Ссылка на пост' }} onUpdate={setLink} />
        </Dialog.Body>
        <Dialog.Footer
          textButtonCancel="Отмена"
          textButtonApply="Отметить"
          propsButtonApply={{ view: 'action' }}
          onClickButtonCancel={() => setClosing(null)}
          onClickButtonApply={() => {
            const target = closing;

            setClosing(null);

            if (target) void run(() => markPublished({ id: target.id, externalUrl: link.trim() || undefined }).unwrap());
          }}
        />
      </Dialog>

      <Dialog open={Boolean(deleting)} onClose={() => setDeleting(null)} maxWidth="s" aria-labelledby="promo-delete-title">
        <Dialog.Header caption="Удалить пост?" id="promo-delete-title" />
        <Dialog.Body>
          <Text variant="body-1">«{deleting?.title}» будет удалён без возможности восстановить.</Text>
        </Dialog.Body>
        <Dialog.Footer
          textButtonCancel="Отмена"
          textButtonApply="Удалить"
          propsButtonApply={{ view: 'outlined-danger' }}
          onClickButtonCancel={() => setDeleting(null)}
          onClickButtonApply={() => {
            const target = deleting;

            setDeleting(null);

            if (target) void run(() => remove(target.id).unwrap());
          }}
        />
      </Dialog>
    </div>
  );
}
