import { useState } from 'react';
import { Alert, Button, Label, Text, TextInput } from '@gravity-ui/uikit';

import { Dialog } from '../../shared/ui/Dialog';
import {
  describeApiError,
  type TelegramRole,
  type TelegramState,
  type TelegramTarget,
  useBindTelegramTargetMutation,
  useUnbindTelegramTargetMutation,
} from '../../store/api';
import styles from '../PromoPage.module.css';

const ROLES: { role: TelegramRole; title: string; hint: string }[] = [
  {
    role: 'news',
    title: 'Канал новостей',
    hint: 'Сюда выходят посты. Бот должен быть администратором канала с правом публиковать сообщения. Опубликуйте в канале что-нибудь (или удалите и снова добавьте бота): тогда канал появится в списке ниже.',
  },
  {
    role: 'discussion',
    title: 'Группа обсуждений',
    hint: 'Сюда бот пишет анонсы постов (если отмечено в посте). В настройках канала → «Обсуждение» выберите эту группу, тогда комментарии под постами пойдут в неё. Бот должен быть в группе; чтобы он её увидел, сделайте его админом или упомяните его в группе (@имя_бота).',
  },
];

const label = (chat: { title: string | null; username: string | null; chatId: string }) =>
  `${chat.title ?? chat.chatId}${chat.username ? ` (@${chat.username})` : ''}`;

function Section({ role, title, hint, state }: { role: TelegramRole; title: string; hint: string; state: TelegramState }) {
  const [bind, binding] = useBindTelegramTargetMutation();
  const [unbind] = useUnbindTelegramTargetMutation();
  const [manual, setManual] = useState('');
  const [error, setError] = useState<string | null>(null);
  const bound: TelegramTarget | null = state[role];
  const candidates = state.candidates.filter((chat) => chat.roles.includes(role) && chat.chatId !== bound?.chatId);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);

    try {
      await action();
      setManual('');
    } catch (err) {
      setError(describeApiError(err));
    }
  };

  return (
    <section className={styles.form} aria-label={title}>
      <div className={styles.head}>
        <Text variant="subheader-2">{title}</Text>
        {bound ? (
          <Label theme="success" size="s">
            привязан
          </Label>
        ) : (
          <Label theme="warning" size="s">
            не привязан
          </Label>
        )}
      </div>
      <Text variant="body-1" color="secondary">
        {hint}
      </Text>

      {bound && (
        <div className={styles.row}>
          <Text variant="body-1">{label(bound)}</Text>
          <Button view="flat-danger" size="s" onClick={() => void run(() => unbind(role).unwrap())}>
            Отвязать
          </Button>
        </div>
      )}

      {candidates.length > 0 && (
        <ul className={styles.plainList}>
          {candidates.map((chat) => (
            <li key={chat.chatId} className={styles.row}>
              <Text variant="body-1">{label(chat)}</Text>
              <Label theme="normal" size="s">
                {chat.botStatus ?? 'бот видел'}
              </Label>
              <Button view="outlined" size="s" loading={binding.isLoading} onClick={() => void run(() => bind({ role, chat: chat.chatId }).unwrap())}>
                Привязать
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.row}>
        <TextInput
          size="m"
          placeholder="@имя, t.me/имя или id (-100…)"
          value={manual}
          controlProps={{ 'aria-label': `Чат для роли «${title}»` }}
          onUpdate={setManual}
        />
        <Button view="outlined" size="m" disabled={manual.trim().length === 0} loading={binding.isLoading} onClick={() => void run(() => bind({ role, chat: manual }).unwrap())}>
          Привязать по имени
        </Button>
      </div>
      {error && <Alert theme="danger" view="filled" message={error} />}
    </section>
  );
}

// Binding the channel (the project's news) and the group (the discussion). The server asks Telegram about the chat before it saves it.
export function TelegramDialog({ state, onClose }: { state: TelegramState; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} maxWidth="m" aria-labelledby="promo-telegram-title">
      <Dialog.Header caption="Telegram: канал и группа" id="promo-telegram-title" />
      <Dialog.Body>
        <div className={styles.form}>
          {!state.botConfigured && (
            <Alert theme="warning" view="filled" message="Бот не настроен на этом bridge (TELEGRAM_BOT_TOKEN): привязать чат нельзя." />
          )}
          {ROLES.map((item) => (
            <Section key={item.role} {...item} state={state} />
          ))}
        </div>
      </Dialog.Body>
      <Dialog.Footer textButtonCancel="Закрыть" onClickButtonCancel={onClose} />
    </Dialog>
  );
}
