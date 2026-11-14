import { useState } from 'react';
import { Alert, Checkbox, Select, TextArea, TextInput, Text } from '@gravity-ui/uikit';

import { Dialog } from '../../shared/ui/Dialog';
import {
  describeApiError,
  type PromoAsset,
  type PromoChannel,
  type PromoMode,
  type PromoPost,
  useCreatePromoPostMutation,
  useUpdatePromoPostMutation,
} from '../../store/api';
import styles from '../PromoPage.module.css';
import { captionLength, captionLimitFor, CHANNEL_LABEL, CHANNELS, fromLocalInput, joinCaption, MODE_LABEL, toLocalInput } from './promoLabels';

interface Props {
  /** The post being edited, or null for a new one. */
  post: PromoPost | null;
  assets: PromoAsset[];
  onClose: () => void;
}

// One form for a new post and for editing a draft; the channel of an existing post does not change.
export function PostDialog({ post, assets, onClose }: Props) {
  const [create, creating] = useCreatePromoPostMutation();
  const [update, updating] = useUpdatePromoPostMutation();
  const [channel, setChannel] = useState<PromoChannel>(post?.channel ?? 'telegram');
  const [title, setTitle] = useState(post?.title ?? '');
  const [textRu, setTextRu] = useState(post?.textRu ?? '');
  const [textEn, setTextEn] = useState(post?.textEn ?? '');
  const [assetIds, setAssetIds] = useState<number[]>(post?.assetIds ?? []);
  const [mode, setMode] = useState<PromoMode>(post?.mode ?? (channel === 'telegram' ? 'auto' : 'reminder'));
  const [scheduled, setScheduled] = useState(toLocalInput(post?.scheduledAt ?? null));
  const [utm, setUtm] = useState(post?.utmCampaign ?? '');
  const [announce, setAnnounce] = useState(post?.announceInGroup ?? false);
  const [error, setError] = useState<string | null>(null);

  const length = captionLength(channel, joinCaption(textRu, textEn));
  const limit = captionLimitFor(channel, assetIds.length > 0);
  const tooLong = length > limit;

  const changeChannel = (next: PromoChannel) => {
    setChannel(next);
    // Only Telegram has an automatic publisher so far.
    setMode(next === 'telegram' ? 'auto' : 'reminder');
  };

  const handleSave = async () => {
    setError(null);

    const body = {
      title: title.trim(),
      textRu,
      textEn,
      assetIds,
      mode,
      scheduledAt: fromLocalInput(scheduled),
      utmCampaign: utm.trim() || null,
      announceInGroup: channel === 'telegram' && announce,
    };

    try {
      if (post) await update({ id: post.id, patch: body }).unwrap();
      else await create({ channel, ...body }).unwrap();

      onClose();
    } catch (err) {
      setError(describeApiError(err));
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="m" aria-labelledby="promo-post-title">
      <Dialog.Header caption={post ? 'Пост' : 'Новый пост'} id="promo-post-title" />
      <Dialog.Body>
        <div className={styles.form}>
          <Select
            size="m"
            label="Канал:"
            disabled={Boolean(post)}
            value={[channel]}
            onUpdate={([value]) => changeChannel(value as PromoChannel)}
            options={CHANNELS.map((value) => ({ value, content: CHANNEL_LABEL[value] }))}
          />
          <TextInput size="m" placeholder="Название" value={title} controlProps={{ 'aria-label': 'Название', maxLength: 200 }} onUpdate={setTitle} />
          <TextArea minRows={5} placeholder="Текст (русский)" value={textRu} controlProps={{ 'aria-label': 'Текст (русский)' }} onUpdate={setTextRu} />
          <TextArea minRows={3} placeholder="Абзац на английском" value={textEn} controlProps={{ 'aria-label': 'Абзац на английском' }} onUpdate={setTextEn} />
          {channel === 'telegram' && (
            <Text variant="caption-2" color="secondary">
              В тексте работают **жирный** и `код`; остальное выходит как написано.
            </Text>
          )}
          <Text variant="caption-2" color={tooLong ? 'danger' : 'secondary'} aria-live="polite">
            {length} / {limit} знаков{assetIds.length > 0 && channel === 'telegram' ? ' (подпись к медиа)' : ''}
          </Text>
          <Select
            size="m"
            label="Файлы:"
            multiple
            placeholder="Без файлов"
            value={assetIds.map(String)}
            onUpdate={(values) => setAssetIds(values.map(Number))}
            options={assets.map((asset) => ({ value: String(asset.id), content: asset.originalName }))}
          />
          <Select
            size="m"
            label="Режим:"
            value={[mode]}
            onUpdate={([value]) => setMode(value as PromoMode)}
            options={(['auto', 'reminder'] as PromoMode[]).map((value) => ({
              value,
              content: MODE_LABEL[value],
              disabled: value === 'auto' && channel !== 'telegram',
            }))}
          />
          <label className={styles.field}>
            <Text variant="caption-2" color="secondary">
              Когда выложить
            </Text>
            <input
              className={styles.dateInput}
              type="datetime-local"
              aria-label="Когда выложить"
              value={scheduled}
              onChange={(event) => setScheduled(event.target.value)}
            />
          </label>
          {channel === 'telegram' && (
            <Checkbox size="m" checked={announce} onUpdate={setAnnounce} content="Анонс в группу обсуждений (со ссылкой на пост)" />
          )}
          <TextInput size="m" placeholder="utm_campaign (необязательно)" value={utm} controlProps={{ 'aria-label': 'utm_campaign', maxLength: 64 }} onUpdate={setUtm} />
          {error && <Alert theme="danger" view="filled" message={error} />}
        </div>
      </Dialog.Body>
      <Dialog.Footer
        textButtonCancel="Отмена"
        textButtonApply="Сохранить"
        propsButtonApply={{ view: 'action', loading: creating.isLoading || updating.isLoading, disabled: title.trim().length === 0 }}
        onClickButtonCancel={onClose}
        onClickButtonApply={() => void handleSave()}
      />
    </Dialog>
  );
}
