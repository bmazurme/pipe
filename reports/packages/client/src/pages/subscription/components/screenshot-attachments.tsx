import { useRef, useState } from 'react';
import { File as FileIcon, Paperclip, Xmark } from '@gravity-ui/icons';
import { Button, Icon, Text } from '@gravity-ui/uikit';

import style from '../subscription.module.css';
import { formatSize, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, toAttachments, type Attachment } from './attachments';

interface ScreenshotAttachmentsProps {
  value: Attachment[];
  onChange: (next: Attachment[]) => void;
  disabled?: boolean;
}

// Files to send with the task — screenshots, letters (.msg), .json, logs, any format: picked from disk, or a picture pasted (Ctrl+V)
// anywhere in the review panel.
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

    if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
    onChange(value.filter((item) => item.id !== id));
  };

  return (
    <div className={style.attachments}>
      <div className={style.attachmentsHeader}>
        <Text variant="body-2">Файлы к задаче</Text>
        <Button view="outlined" size="s" disabled={disabled || value.length >= MAX_ATTACHMENTS} onClick={() => input.current?.click()}>
          <Icon data={Paperclip} size={14} />
          Прикрепить
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          aria-label="Выбрать файлы"
          onChange={(event) => {
            void take(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
      </div>

      {value.length === 0 ? (
        <Text variant="caption-2" color="secondary">
          Любой файл: скриншот, письмо (.msg), .json, лог и т. д. — до {MAX_ATTACHMENT_BYTES / 1024 / 1024} МБ каждый, не больше {MAX_ATTACHMENTS}.
          Изображение можно вставить из буфера (Ctrl+V). Вложения уходят как есть: они не проходят ни замену по словарю, ни проверку
          на утечки — убедитесь, что в них нет секретов и реальных имён.
        </Text>
      ) : (
        <ul className={style.attachmentList}>
          {value.map((item) => (
            <li key={item.id} className={style.attachment}>
              {item.previewUrl ? (
                <img src={item.previewUrl} alt={item.name} className={style.attachmentPreview} />
              ) : (
                <span className={`${style.attachmentPreview} ${style.attachmentFile}`} aria-hidden="true">
                  <Icon data={FileIcon} size={20} />
                </span>
              )}
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
