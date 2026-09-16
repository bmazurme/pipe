import { DragEvent, useRef, useState } from 'react';
import { CloudArrowUpIn } from '@gravity-ui/icons';
import { Button, Icon, Progress, Text } from '@gravity-ui/uikit';

import { MAX_FILE_SIZE_MB } from '../../store/api';
import styles from '../StoragePage.module.css';

export interface UploadProgress {
  /** Name of the file currently going up. */
  name: string;
  /** 1-based position in the batch, for the "2 из 5" counter. */
  index: number;
  total: number;
  percent: number;
}

interface StorageDropzoneProps {
  upload: UploadProgress | null;
  onUpload: (files: File[]) => void;
}

export function StorageDropzone({ upload, onUpload }: StorageDropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Counts nested dragenter/dragleave pairs so hovering a child doesn't drop the highlight.
  const dragDepth = useRef(0);

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragOver(false);

    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length > 0) onUpload(files);
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

      {upload ? (
        // A 200 MB limit and a bare button spinner don't go together — an
        // upload that takes minutes has to show that it's moving.
        <div className={styles.uploadStatus}>
          <Text variant="subheader-2">
            {upload.total > 1
              ? `Загрузка ${upload.index} из ${upload.total}`
              : 'Загрузка'}
          </Text>
          <Text color="secondary" variant="body-1" ellipsis title={upload.name}>
            {upload.name}
          </Text>
          <Progress value={upload.percent} text={`${upload.percent}%`} size="m" />
        </div>
      ) : (
        <>
          <Text variant="subheader-2">
            {isDragOver ? 'Отпустите файлы' : 'Перетащите файлы сюда'}
          </Text>
          <Button view="action" size="l" onClick={() => fileInputRef.current?.click()}>
            Выбрать файлы
          </Button>
          <Text color="hint" variant="caption-2" className={styles.dropzoneHint}>
            До {MAX_FILE_SIZE_MB} МБ на файл · файл удаляется с сервера сразу
            после скачивания
          </Text>
        </>
      )}

      <input
        ref={fileInputRef}
        type="file"
        hidden
        multiple
        onChange={(event) => {
          // Snapshot into an array before clearing value — resetting a file
          // input live-mutates the same FileList the browser handed back.
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length > 0) onUpload(files);
        }}
      />
    </div>
  );
}
