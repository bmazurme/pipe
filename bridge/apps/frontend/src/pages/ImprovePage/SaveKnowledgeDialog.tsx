import { useMemo, useState } from 'react';
import { Alert, Link, SegmentedRadioGroup, Text, TextArea, TextInput } from '@gravity-ui/uikit';
import { findCredentials } from '@pipe/protocol/credentials';

import { Dialog } from '../../shared/ui/Dialog';
import { getErrorMessage, type KnowledgeTarget, type SavedKnowledge, useSaveKnowledgeMutation } from '../../store/api';

export const MAX_KNOWLEDGE_TITLE = 160;
export const MAX_KNOWLEDGE_TEXT = 3000;

interface SaveKnowledgeDialogProps {
  /** The wording to start from — the owner edits it before it goes into the repository. */
  initialTitle: string;
  initialText: string;
  /** Where it comes from, for the pull request ("вопрос 12-3", "Context «Правила»"). */
  source: string;
  onClose: () => void;
}

const TARGET_HINT: Record<KnowledgeTarget, string> = {
  'claude-md': 'CLAUDE.md — раздел «Постоянные знания»: его читает каждый агент, открывший репозиторий. Для коротких правил.',
  docs: 'docs/knowledge.md — отдельный файл: для длинного и узкого, агент его сам не читает.',
};

// A8: the entry becomes a pull request (never a commit to main) that the owner reviews and merges like any other.
export function SaveKnowledgeDialog({ initialTitle, initialText, source, onClose }: SaveKnowledgeDialogProps) {
  const [save, { isLoading }] = useSaveKnowledgeMutation();
  const [title, setTitle] = useState(initialTitle.slice(0, MAX_KNOWLEDGE_TITLE));
  const [text, setText] = useState(initialText.slice(0, MAX_KNOWLEDGE_TEXT));
  const [target, setTarget] = useState<KnowledgeTarget>('claude-md');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedKnowledge | null>(null);
  const credentials = useMemo(() => findCredentials(`${title}\n${text}`), [title, text]);

  const handleSave = async () => {
    setError(null);

    try {
      setSaved(await save({ title: title.trim(), text: text.trim(), target, source }).unwrap());
    } catch (err) {
      setError(typeof err === 'string' && err ? err : getErrorMessage(err, 'Не удалось открыть PR'));
    }
  };

  if (saved) {
    return (
      <Dialog open onClose={onClose} maxWidth="m" aria-labelledby="knowledge-title">
        <Dialog.Header caption="Pull request открыт" id="knowledge-title" />
        <Dialog.Body>
          <Text>
            Знание добавлено в {saved.path} в{' '}
            <Link href={saved.url} target="_blank" rel="noreferrer">
              PR #{saved.number}
            </Link>
            . Запись попадёт в репозиторий после слияния — как обычно: CI → Telegram → Merge.
          </Text>
        </Dialog.Body>
        <Dialog.Footer textButtonApply="Закрыть" onClickButtonApply={onClose} />
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} maxWidth="l" aria-labelledby="knowledge-title">
      <Dialog.Header caption="Сохранить как постоянное знание" id="knowledge-title" />
      <Dialog.Body>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Text variant="body-1" color="secondary">
            Откроется pull request, который добавит запись в репозиторий. Он не влит, пока вы сами его не примете. Отредактируйте формулировку так, как она должна читаться через полгода.
          </Text>
          <TextInput
            label="Заголовок"
            value={title}
            onUpdate={setTitle}
            controlProps={{ maxLength: MAX_KNOWLEDGE_TITLE, 'aria-label': 'Заголовок знания' }}
          />
          <TextArea
            value={text}
            onUpdate={setText}
            minRows={5}
            maxRows={14}
            controlProps={{ maxLength: MAX_KNOWLEDGE_TEXT, 'aria-label': 'Текст знания' }}
          />
          <SegmentedRadioGroup size="m" value={target} onUpdate={(value) => setTarget(value as KnowledgeTarget)} aria-label="Куда записать">
            <SegmentedRadioGroup.Option value="claude-md">CLAUDE.md</SegmentedRadioGroup.Option>
            <SegmentedRadioGroup.Option value="docs">docs/knowledge.md</SegmentedRadioGroup.Option>
          </SegmentedRadioGroup>
          <Text variant="caption-2" color="secondary">
            {TARGET_HINT[target]}
          </Text>
          {initialText.length > MAX_KNOWLEDGE_TEXT && (
            <Alert theme="warning" view="filled" message={`Исходный текст длиннее ${MAX_KNOWLEDGE_TEXT} символов — взято начало. Постоянное знание должно быть коротким: оставьте главное.`} />
          )}
          {credentials.length > 0 && (
            <Alert
              theme="danger"
              view="filled"
              message={`В тексте есть то, что похоже на ключ: ${credentials.map((found) => `${found.label} (${found.preview})`).join(', ')}. В репозиторий такое не записывается — уберите.`}
            />
          )}
          {error && <Alert theme="danger" view="filled" message={error} />}
        </div>
      </Dialog.Body>
      <Dialog.Footer
        textButtonCancel="Отмена"
        onClickButtonCancel={onClose}
        textButtonApply="Открыть PR"
        propsButtonApply={{ loading: isLoading, disabled: !title.trim() || !text.trim() || credentials.length > 0 }}
        onClickButtonApply={() => void handleSave()}
      />
    </Dialog>
  );
}
