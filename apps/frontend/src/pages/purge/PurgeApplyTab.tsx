import { KeyboardEvent, useState } from 'react';
import { Copy } from '@gravity-ui/icons';
import {
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
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  const handleApply = () => {
    const dictionary = buildDictionary(entries, direction);
    const { result, count } = applyDictionary(text, dictionary);

    dispatch(draftTextChanged(result));
    setCopyMessage(null);
    setApplyMessage(
      count > 0
        ? `Заменено слов: ${count}`
        : 'Совпадений со словарём не найдено',
    );
  };

  // The result stays in the field (and in localStorage, via PurgePage's sync
  // effects) until this succeeds — only a confirmed copy clears it, so a
  // failed clipboard write never loses the text.
  const handleCopy = async () => {
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      dispatch(draftTextChanged(''));
      setApplyMessage(null);
      setCopyMessage('Скопировано в буфер обмена — поле очищено');
    } catch {
      setCopyMessage('Не удалось скопировать — проверьте разрешения браузера');
    }
  };

  const handleTextareaKeyDown = (event: KeyboardEvent) => {
    if (
      (event.metaKey || event.ctrlKey) &&
      event.key === 'Enter' &&
      text &&
      entries.length > 0
    ) {
      event.preventDefault();
      handleApply();
    }
  };

  return (
    <div className={styles.tabPanel}>
      <Card view="outlined" className={styles.card}>
        <div className={styles.form}>
          <SegmentedRadioGroup
            value={direction}
            onUpdate={(value) => setDirection(value as Direction)}
            width="max"
          >
            <SegmentedRadioGroup.Option value="keyToValue">
              Ключ → значение
            </SegmentedRadioGroup.Option>
            <SegmentedRadioGroup.Option value="valueToKey">
              Значение → ключ
            </SegmentedRadioGroup.Option>
          </SegmentedRadioGroup>

          <TextArea
            value={text}
            onUpdate={(value) => {
              dispatch(draftTextChanged(value));
              setApplyMessage(null);
              setCopyMessage(null);
            }}
            onKeyDown={handleTextareaKeyDown}
            placeholder="Вставьте текст"
            // Hugs short text instead of always showing a 10-row box; still
            // grows unbounded for long pastes, same as before.
            minRows={4}
            size="l"
          />

          {applyMessage && <Text color="secondary">{applyMessage}</Text>}
          {copyMessage && <Text color="secondary">{copyMessage}</Text>}

          <div className={styles.buttonRow}>
            <Button
              view="action"
              size="l"
              disabled={!text || entries.length === 0}
              title="⌘/Ctrl + Enter"
              onClick={handleApply}
            >
              Сохранить
            </Button>
            <Button
              view="outlined"
              size="l"
              disabled={!text}
              onClick={() => void handleCopy()}
            >
              <Icon data={Copy} size={16} />
              Копировать
            </Button>
          </div>

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
