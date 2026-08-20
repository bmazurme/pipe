import { KeyboardEvent, useState } from 'react';
import { Copy } from '@gravity-ui/icons';
import {
  Alert,
  Button,
  Icon,
  SegmentedRadioGroup,
  Card,
  Text,
  TextArea,
} from '@gravity-ui/uikit';

import { useListEntriesQuery } from '../../store/api';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { draftTextChanged, purgeEntriesSelector, purgeTextSelector } from '../../store/slices';
import styles from '../PurgePage.module.css';
import { applyDictionary, buildDictionary, Direction } from './purgeUtils';

interface PurgeApplyTabProps {
  onGoToDictionary: () => void;
}

export function PurgeApplyTab({ onGoToDictionary }: PurgeApplyTabProps) {
  const dispatch = useAppDispatch();
  const { isLoading } = useListEntriesQuery();
  const entries = useAppSelector(purgeEntriesSelector);
  const text = useAppSelector(purgeTextSelector);

  const [direction, setDirection] = useState<Direction>('keyToValue');
  // One notice, not one per action: every path already cleared the other's
  // message, so only one was ever on screen. Carrying the tone with the text
  // is what lets a failed copy read as a failure instead of grey small print.
  const [notice, setNotice] = useState<{ text: string; isError: boolean } | null>(null);

  const canApply = Boolean(text) && entries.length > 0;

  const handleApply = () => {
    const dictionary = buildDictionary(entries, direction);
    const { result, count } = applyDictionary(text, dictionary);

    dispatch(draftTextChanged(result));
    setNotice({
      text: count > 0 ? `Заменено слов: ${count}` : 'Совпадений со словарём не найдено',
      isError: false,
    });
  };

  // The result stays in the field (and in localStorage, via PurgePage's sync
  // effects) until this succeeds — only a confirmed copy clears it, so a
  // failed clipboard write never loses the text.
  const handleCopy = async () => {
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      dispatch(draftTextChanged(''));
      setNotice({ text: 'Скопировано в буфер обмена — поле очищено', isError: false });
    } catch {
      setNotice({
        text: 'Не удалось скопировать — проверьте разрешения браузера',
        isError: true,
      });
    }
  };

  // A disabled button with no reason is a dead end; say what's missing.
  const applyHint =
    entries.length === 0
      ? 'Словарь пуст'
      : text
        ? '⌘/Ctrl + Enter'
        : 'Вставьте текст в поле ниже';

  const handleTextareaKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canApply) {
      event.preventDefault();
      handleApply();
    }
  };

  return (
    <div className={styles.tabPanel}>
      <Card view="outlined" className={styles.card}>
        <div className={styles.form}>
          {/* Direction and both actions sit in one row above the field, so the
              whole control set is in view before you start reading the text —
              and the field itself, which grows without limit, stays the last
              thing on the card. */}
          <div className={styles.toolbar}>
            <SegmentedRadioGroup
              value={direction}
              onUpdate={(value) => setDirection(value as Direction)}
              className={styles.direction}
            >
              <SegmentedRadioGroup.Option value="keyToValue">
                Ключ → значение
              </SegmentedRadioGroup.Option>
              <SegmentedRadioGroup.Option value="valueToKey">
                Значение → ключ
              </SegmentedRadioGroup.Option>
            </SegmentedRadioGroup>

            <div className={styles.buttonRow}>
              <Button
                view="action"
                size="m"
                disabled={!canApply}
                title={applyHint}
                onClick={handleApply}
              >
                Сохранить
              </Button>
              <Button
                view="outlined"
                size="m"
                disabled={!text}
                title={text ? 'Скопировать и очистить поле' : 'Поле пустое'}
                onClick={() => void handleCopy()}
              >
                <Icon data={Copy} size={16} />
                Копировать
              </Button>
            </div>
          </div>

          <TextArea
            value={text}
            onUpdate={(value) => {
              dispatch(draftTextChanged(value));
              setNotice(null);
            }}
            onKeyDown={handleTextareaKeyDown}
            placeholder="Вставьте текст"
            // Hugs short text instead of always showing a 10-row box; still
            // grows unbounded for long pastes, same as before.
            minRows={4}
            size="l"
            hasClear
            // The actions scroll out of view once a long text is pasted, so
            // the shortcut is worth stating rather than hiding in a tooltip.
            note={
              text
                ? `Символов: ${text.length.toLocaleString('ru-RU')}${canApply ? ' · ⌘/Ctrl + Enter — заменить' : ''}`
                : undefined
            }
          />

          {notice &&
            (notice.isError ? (
              <Alert
                className={styles.notice}
                theme="danger"
                view="filled"
                message={notice.text}
                onClose={() => setNotice(null)}
              />
            ) : (
              <Text color="secondary">{notice.text}</Text>
            ))}

          {entries.length === 0 && !isLoading && (
            <div className={styles.emptyHint}>
              <Text color="secondary">
                Словарь пуст — добавьте пары ключ/значение, чтобы начать.
              </Text>
              <Button view="flat-action" size="s" onClick={onGoToDictionary}>
                Перейти к словарю
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
