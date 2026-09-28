import { KeyboardEvent, useState } from 'react';
import { Copy } from '@gravity-ui/icons';
import {
  Alert,
  Button,
  Card,
  Icon,
  SegmentedRadioGroup,
  Text,
  TextArea,
} from '@gravity-ui/uikit';
import type { LeakFindingType } from '@reports/shared';

import PageHeader from '../../components/page-header';
import { useDocumentTitle } from '../../hooks/use-document-title';
import {
  useAddDictionaryEntryMutation,
  useApplyPurgeMutation,
  useGetSubscriptionConfigQuery,
} from '../../store/api';
import { describeError } from '../../utils/describe-error';
import { suggestUniqueValue } from './purge-utils';

import style from './purge.module.css';

type Direction = 'toRemote' | 'toLocal';

function findingKey(finding: LeakFindingType): string {
  return `${finding.kind}:${finding.match}:${finding.line}`;
}

function Purge() {
  useDocumentTitle('Purge');

  const { data: config, isLoading: isConfigLoading } = useGetSubscriptionConfigQuery();
  const [applyPurge, { isLoading: isApplying }] = useApplyPurgeMutation();
  const [addDictionaryEntry] = useAddDictionaryEntryMutation();

  const [direction, setDirection] = useState<Direction>('toRemote');
  const [text, setText] = useState('');
  const [notice, setNotice] = useState<{ text: string; isError: boolean } | null>(null);
  const [leakWarning, setLeakWarning] = useState<LeakFindingType[] | null>(null);
  const [addingFinding, setAddingFinding] = useState<string | null>(null);
  const [addErrors, setAddErrors] = useState<Record<string, string>>({});

  const entries = config?.dictionary ?? [];
  const canApply = Boolean(text) && entries.length > 0;

  const handleApply = async () => {
    try {
      const { result, count, leaks } = await applyPurge({ text, direction }).unwrap();

      setText(result);
      setNotice({
        text: count > 0 ? `Заменено слов: ${count}` : 'Совпадений со словарём не найдено',
        isError: false,
      });
      setLeakWarning(leaks.length > 0 ? leaks : null);
    } catch (error) {
      setNotice({ text: describeError(error, 'Не удалось применить словарь'), isError: true });
      setLeakWarning(null);
    }
  };

  const handleAddFindingToDictionary = async (finding: LeakFindingType) => {
    const key = findingKey(finding);
    setAddingFinding(key);
    setAddErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key)));

    try {
      const value = suggestUniqueValue(finding.match.length, new Set(entries.map((entry) => entry.value)));
      await addDictionaryEntry({ key: finding.match, value }).unwrap();
      setLeakWarning((prev) => {
        const next = (prev ?? []).filter((item) => item !== finding);
        return next.length > 0 ? next : null;
      });
    } catch (error) {
      setAddErrors((prev) => ({ ...prev, [key]: describeError(error, 'Не удалось добавить в словарь') }));
    } finally {
      setAddingFinding(null);
    }
  };

  const handleCopy = async () => {
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      setText('');
      setNotice({ text: 'Скопировано в буфер обмена — поле очищено', isError: false });
      setLeakWarning(null);
    } catch {
      setNotice({ text: 'Не удалось скопировать — проверьте разрешения браузера', isError: true });
    }
  };

  const applyHint = entries.length === 0
    ? 'Словарь пуст'
    : text
      ? '⌘/Ctrl + Enter'
      : 'Вставьте текст в поле ниже';

  const handleTextareaKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canApply) {
      event.preventDefault();
      void handleApply();
    }
  };

  return (
    <div className={style.wrapper}>
      <PageHeader
        title="Purge"
        description="Подстановка словаря подписки — тот же словарь, что использует Subscription при push/pull"
      />

      <Card view="outlined" className={style.card}>
        <div className={style.form}>
          <div className={style.toolbar}>
            <SegmentedRadioGroup
              value={direction}
              onUpdate={(value) => setDirection(value as Direction)}
              className={style.direction}
            >
              <SegmentedRadioGroup.Option value="toRemote">
                Ключ → значение
              </SegmentedRadioGroup.Option>
              <SegmentedRadioGroup.Option value="toLocal">
                Значение → ключ
              </SegmentedRadioGroup.Option>
            </SegmentedRadioGroup>

            <div className={style.buttonRow}>
              <Button
                view="action"
                size="m"
                disabled={!canApply}
                loading={isApplying}
                title={applyHint}
                onClick={() => void handleApply()}
              >
                Применить
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

          {notice && (
            notice.isError ? (
              <Alert
                className={style.notice}
                theme="danger"
                view="filled"
                message={notice.text}
                onClose={() => setNotice(null)}
              />
            ) : (
              <Text color="secondary">{notice.text}</Text>
            )
          )}

          {leakWarning && (
            <Alert
              className={style.notice}
              theme="warning"
              view="filled"
              title="Похоже, анонимизация неполная"
              message={(
                <ul className={style.leakList}>
                  {leakWarning.map((finding) => {
                    const key = findingKey(finding);

                    return (
                      <li key={key} className={style.leakItem}>
                        <span>{finding.kind}: {finding.match}</span>
                        <Button
                          view="outlined"
                          size="xs"
                          loading={addingFinding === key}
                          onClick={() => void handleAddFindingToDictionary(finding)}
                        >
                          В словарь
                        </Button>
                        {addErrors[key] && (
                          <Text color="danger" variant="caption-2" className={style.leakItemError}>
                            {addErrors[key]}
                          </Text>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              onClose={() => setLeakWarning(null)}
            />
          )}

          <TextArea
            value={text}
            onUpdate={(value) => {
              setText(value);
              setNotice(null);
              setLeakWarning(null);
            }}
            onKeyDown={handleTextareaKeyDown}
            placeholder="Вставьте текст"
            minRows={4}
            size="l"
            hasClear
            note={text ? `Символов: ${text.length.toLocaleString('ru-RU')}${canApply ? ' · ⌘/Ctrl + Enter — заменить' : ''}` : undefined}
          />

          {entries.length === 0 && !isConfigLoading && (
            <Text color="secondary">
              Словарь пуст — добавьте пары ключ/значение в Настройках, чтобы начать.
            </Text>
          )}
        </div>
      </Card>
    </div>
  );
}

export default Purge;
