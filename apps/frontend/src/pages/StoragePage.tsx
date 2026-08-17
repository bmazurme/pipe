import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, CloudArrowUpIn, Paperclip } from '@gravity-ui/icons';
import {
  Alert,
  Button,
  Card,
  Icon,
  Loader,
  Table,
  Text,
} from '@gravity-ui/uikit';

import {
  downloadFile,
  listFiles,
  MAX_FILE_SIZE_BYTES,
  StoredFileMeta,
  uploadFile,
} from '../shared/api/storage';
import { useIsMobile } from '../shared/lib/useIsMobile';
import styles from './StoragePage.module.css';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function StoragePage() {
  const [files, setFiles] = useState<StoredFileMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const isMobile = useIsMobile();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Counts nested dragenter/dragleave pairs so hovering a child doesn't drop the highlight.
  const dragDepth = useRef(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const result = await listFiles();
        if (!cancelled) setFiles(result);
      } catch {
        if (!cancelled) setError('Не удалось загрузить список файлов');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleUpload = async (file: File) => {
    setError(null);

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError(`«${file.name}» превышает лимит 10 МБ`);
      return;
    }

    setIsUploading(true);
    try {
      const uploaded = await uploadFile(file);
      setFiles((prev) => [uploaded, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить файл');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDownload = async (file: StoredFileMeta) => {
    setError(null);
    setDownloadingId(file.id);
    try {
      await downloadFile(file);
      setFiles((prev) => prev.filter((item) => item.id !== file.id));
    } catch {
      setError('Не удалось скачать файл');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragOver(false);

    const file = event.dataTransfer.files?.[0];
    if (file) void handleUpload(file);
  };

  const handleDragEnter = (event: React.DragEvent) => {
    event.preventDefault();
    dragDepth.current += 1;
    setIsDragOver(true);
  };

  const handleDragLeave = (event: React.DragEvent) => {
    event.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setIsDragOver(false);
    }
  };

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Text variant="header-1" as="h1">
          Storage
        </Text>
        <Text color="secondary">
          До 10 МБ на файл. Файл удаляется с сервера сразу после скачивания.
        </Text>
      </div>

      <div
        className={`${styles.dropzone} ${isDragOver ? styles.dropzoneActive : ''}`}
        onDragEnter={handleDragEnter}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <Icon data={CloudArrowUpIn} size={32} className={styles.dropzoneIcon} />
        <Text variant="subheader-2">
          {isDragOver ? 'Отпустите файл' : 'Перетащите файл сюда'}
        </Text>
        <Text color="secondary">или</Text>
        <Button
          view="action"
          size="l"
          loading={isUploading}
          onClick={() => fileInputRef.current?.click()}
        >
          Выбрать файл
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void handleUpload(file);
          }}
        />
      </div>

      {error && (
        <Alert
          theme="danger"
          view="filled"
          message={error}
          onClose={() => setError(null)}
        />
      )}

      <Card view="outlined" className={styles.filesCard}>
        <div className={styles.filesHeader}>
          <Text variant="subheader-2">Файлы</Text>
          {files.length > 0 && (
            <Text color="secondary">
              {files.length} · {formatSize(totalSize)}
            </Text>
          )}
        </div>

        {isLoading && (
          <div className={styles.centered}>
            <Loader size="m" />
          </div>
        )}

        {!isLoading && files.length === 0 && (
          <div className={styles.centered}>
            <Icon data={Paperclip} size={24} className={styles.emptyIcon} />
            <Text color="secondary">Файлов пока нет</Text>
          </div>
        )}

        {/* A 4-column table would push the download action off a phone screen. */}
        {!isLoading && files.length > 0 && isMobile && (
          <ul className={styles.fileList}>
            {files.map((file) => (
              <li key={file.id} className={styles.fileRow}>
                <div className={styles.fileInfo}>
                  <Text ellipsis>{file.originalName}</Text>
                  <Text color="secondary" ellipsis>
                    {formatSize(file.size)} · {formatDate(file.createdAt)}
                  </Text>
                </div>
                <Button
                  view="flat"
                  title="Скачать и удалить с сервера"
                  aria-label={`Скачать ${file.originalName}`}
                  loading={downloadingId === file.id}
                  onClick={() => void handleDownload(file)}
                >
                  <Icon data={ArrowDownToLine} size={16} />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {!isLoading && files.length > 0 && !isMobile && (
          <div className={styles.tableWrapper}>
            <Table
              width="max"
              data={files}
              getRowId={(item) => String(item.id)}
              columns={[
                {
                  id: 'originalName',
                  name: 'Имя файла',
                  primary: true,
                },
                {
                  id: 'size',
                  name: 'Размер',
                  align: 'end',
                  template: (item) => formatSize(item.size),
                },
                {
                  id: 'createdAt',
                  name: 'Загружен',
                  template: (item) => formatDate(item.createdAt),
                },
                {
                  id: 'actions',
                  name: '',
                  align: 'end',
                  template: (item) => (
                    <Button
                      view="flat"
                      size="s"
                      title="Скачать и удалить с сервера"
                      loading={downloadingId === item.id}
                      onClick={() => void handleDownload(item)}
                    >
                      <Icon data={ArrowDownToLine} size={16} />
                      Скачать
                    </Button>
                  ),
                },
              ]}
            />
          </div>
        )}
      </Card>
    </div>
  );
}
