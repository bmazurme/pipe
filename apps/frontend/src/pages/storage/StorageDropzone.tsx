import { DragEvent, useRef, useState } from 'react';
import { CloudArrowUpIn } from '@gravity-ui/icons';
import { Button, Icon, Text } from '@gravity-ui/uikit';

import { MAX_FILE_SIZE_MB } from '../../store/api';
import styles from '../StoragePage.module.css';

interface StorageDropzoneProps {
  isUploading: boolean;
  onUpload: (file: File) => void;
}

export function StorageDropzone({ isUploading, onUpload }: StorageDropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Counts nested dragenter/dragleave pairs so hovering a child doesn't drop the highlight.
  const dragDepth = useRef(0);

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragOver(false);

    const file = event.dataTransfer.files?.[0];
    if (file) onUpload(file);
  };

  const handleDragEnter = (event: DragEvent) => {
    event.preventDefault();
    dragDepth.current += 1;
    setIsDragOver(true);
  };

  const handleDragLeave = (event: DragEvent) => {
    event.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setIsDragOver(false);
    }
  };

  return (
    <div
      className={`${styles.dropzone} ${isDragOver ? styles.dropzoneActive : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <span className={styles.dropzoneIcon}>
        <Icon data={CloudArrowUpIn} size={24} />
      </span>
      <Text variant="subheader-2">
        {isDragOver ? 'Отпустите файл' : 'Перетащите файл сюда'}
      </Text>
      <Button
        view="action"
        size="l"
        loading={isUploading}
        onClick={() => fileInputRef.current?.click()}
      >
        Выбрать файл
      </Button>
      <Text color="hint" variant="caption-2" className={styles.dropzoneHint}>
        До {MAX_FILE_SIZE_MB} МБ · файл удаляется с сервера сразу после скачивания
      </Text>
      <input
        ref={fileInputRef}
        type="file"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onUpload(file);
        }}
      />
    </div>
  );
}
