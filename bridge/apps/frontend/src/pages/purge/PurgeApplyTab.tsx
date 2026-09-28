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
import { scanForLeaks, type LeakFinding } from '@pipe/protocol/leakScan';

import { useCreateEntryMutation, useListEntriesQuery } from '../../store/api';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { draftTextChanged, purgeEntriesSelector, purgeTextSelector } from '../../store/slices';
import styles from '../PurgePage.module.css';
import { applyDictionary, buildDictionary, Direction, suggestUniqueValue } from './purgeUtils';

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
  // Separate from `notice`: this is advisory, not a result of the action
  // just taken — it survives independently so a copy (which only clears
  // `notice`'s cousin, the field itself) doesn't silently drop the warning.
  const [leakWarning, setLeakWarning] = useState<LeakFinding[] | null>(null);
  const [createEntryTrigger] = useCreateEntryMutation();
  // Keyed by findingKey(), not array index — findings get removed from the
  // list as they're resolved, which would shift indices out from under an
  // in-flight request otherwise.
  const [addingFinding, setAddingFinding] = useState<string | null>(null);
  const [addErrors, setAddErrors] = useState<Record<string, string>>({});

  const canApply = Boolean(text) && entries.length > 0;

  const findingKey = (finding: LeakFinding) => `${finding.kind}:${finding.match}:${finding.line}`;

  // Auto-generates the placeholder (same length as the real value, same
  // collision-avoidance as the Dictionary tab's own "add entry" form) so
  // resolving a leak-scan finding is one click, not a trip to retype it.
  const handleAddFindingToDictionary = async (finding: LeakFinding) => {
    const key = findingKey(finding);
    setAddingFinding(key);
    setAddErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key)));

    try {
      const value = suggestUniqueValue(finding.match.length, new Set(entries.map((entry) => entry.value)));
      await createEntryTrigger({ key: finding.match, value }).unwrap();
      setLeakWarning((prev) => {
        const next = (prev ?? []).filter((item) => item !== finding);
        return next.length > 0 ? next : null;
      });
    } catch (error) {
      // createEntry's transformErrorResponse reduces a failed response to a
      // plain friendly string (e.g. duplicate-key), and unwrap() throws
      // exactly that string — same pattern PurgeDictionaryTab's own
      // add-entry form uses for this identical mutation.
      const message = typeof error === 'string' ? error : 'Не удалось добавить в словарь';
      setAddErrors((prev) => ({ ...prev, [key]: message }));
    } finally {
      setAddingFinding(null);
    }
  };

  const handleApply = () => {
    const dictionary = buildDictionary(entries, direction);
    const { result, count } = applyDictionary(text, dictionary);

    dispatch(draftTextChanged(result));
    setNotice({
      text: count > 0 ? `Заменено слов: ${count}` : 'Совпадений со словарём не найдено',
      isError: false,
    });

    // Heuristic check on the *result*, not the input — this is the same
    // "did the dictionary actually catch everything" question sync/reports
    // ask before a parcel leaves, applied here since Purge's whole job is
    // producing text that's about to be pasted somewhere external.
    const findings = scanForLeaks([{ source: 'результат', content: result }]);
    setLeakWarning(findings.length > 0 ? findings : null);
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
      setLeakWarning(null);
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

          {leakWarning && (
            <Alert
              className={styles.notice}
              theme="warning"
              view="filled"
              title="Похоже, анонимизация неполная"
              message={
                <ul className={styles.leakList}>
                  {leakWarning.map((finding) => {
                    const key = findingKey(finding);

                    return (
                      <li key={key} className={styles.leakItem}>
                        <span>
                          {finding.kind}: {finding.match}
                        </span>
                        <Button
                          view="outlined"
                          size="xs"
                          loading={addingFinding === key}
                          onClick={() => void handleAddFindingToDictionary(finding)}
                        >
                          В словарь
                        </Button>
                        {addErrors[key] && (
                          <Text color="danger" variant="caption-2" className={styles.leakItemError}>
                            {addErrors[key]}
                          </Text>
                        )}
                      </li>
                    );
                  })}
                </ul>
              }
              onClose={() => setLeakWarning(null)}
            />
          )}

          <TextArea
            value={text}
            onUpdate={(value) => {
              dispatch(draftTextChanged(value));
              setNotice(null);
              setLeakWarning(null);
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
