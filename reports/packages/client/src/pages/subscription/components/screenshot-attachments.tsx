import { useRef, useState } from 'react';
import { Paperclip, Xmark } from '@gravity-ui/icons';
import { Button, Icon, Text } from '@gravity-ui/uikit';

import style from '../subscription.module.css';
import { ACCEPTED_TYPES, formatSize, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, toAttachments, type Attachment } from './attachments';

interface ScreenshotAttachmentsProps {
  value: Attachment[];
  onChange: (next: Attachment[]) => void;
  disabled?: boolean;
}

// Screenshots to send with the task: picked from disk, or pasted (Ctrl+V) anywhere in the review panel.
export function ScreenshotAttachments({ value, onChange, disabled }: ScreenshotAttachmentsProps) {
  const input = useRef<HTMLInputElement>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const take = async (files: File[]) => {
    const { added, problems: refused } = await toAttachments(files, value.length);

    setProblems(refused);
    if (added.length > 0) onChange([...value, ...added]);
  };

  const remove = (id: string) => {
    const gone = value.find((item) => item.id === id);

    if (gone) URL.revokeObjectURL(gone.previewUrl);
    onChange(value.filter((item) => item.id !== id));
  };

  return (
    <div className={style.attachments}>
      <div className={style.attachmentsHeader}>
        <Text variant="body-2">Скриншоты к задаче</Text>
        <Button view="outlined" size="s" disabled={disabled || value.length >= MAX_ATTACHMENTS} onClick={() => input.current?.click()}>
          <Icon data={Paperclip} size={14} />
          Прикрепить
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept={ACCEPTED_TYPES.join(',')}
          aria-label="Выбрать скриншоты"
          onChange={(event) => {
            void take(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
      </div>

      {value.length === 0 ? (
        <Text variant="caption-2" color="secondary">
          Выберите файлы или вставьте изображение из буфера (Ctrl+V). PNG, JPEG, GIF, WebP — до {MAX_ATTACHMENT_BYTES / 1024 / 1024} МБ каждый.
          Скриншоты не проходят проверку на утечки — убедитесь, что на них нет секретов.
        </Text>
      ) : (
        <ul className={style.attachmentList}>
          {value.map((item) => (
            <li key={item.id} className={style.attachment}>
              <img src={item.previewUrl} alt={item.name} className={style.attachmentPreview} />
              <span className={style.attachmentName} title={item.name}>
                {item.name}
              </span>
              <Text variant="caption-2" color="secondary">
                {formatSize(item.size)}
              </Text>
              <Button view="flat" size="xs" disabled={disabled} aria-label={`Убрать ${item.name}`} onClick={() => remove(item.id)}>
                <Icon data={Xmark} size={12} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {problems.map((problem) => (
        <Text key={problem} variant="caption-2" color="danger">
          {problem}
        </Text>
      ))}
    </div>
  );
}
