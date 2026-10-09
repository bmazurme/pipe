import { useRef } from 'react';
import { Paperclip } from '@gravity-ui/icons';
import { Button, Icon } from '@gravity-ui/uikit';

import { ATTACHMENT_ACCEPT } from './chatAttachments';

interface AttachButtonProps {
  disabled: boolean;
  /** Why attaching is unavailable, shown as the tooltip. */
  disabledReason?: string;
  onFiles: (files: File[]) => void;
}

export function AttachButton({ disabled, disabledReason, onFiles }: AttachButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <Button
        view="flat-secondary"
        size="m"
        disabled={disabled}
        title={disabled ? disabledReason : 'Прикрепить изображение или файл'}
        aria-label="Прикрепить файл"
        onClick={() => inputRef.current?.click()}
      >
        <Icon data={Paperclip} size={16} />
      </Button>
      <input
        ref={inputRef}
        type="file"
        hidden
        multiple
        accept={ATTACHMENT_ACCEPT}
        aria-label="Выбор файлов для вложения"
        onChange={(event) => {
          // Snapshot before clearing: resetting the value empties the live FileList.
          const files = Array.from(event.target.files ?? []);

          event.target.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
    </>
  );
}
