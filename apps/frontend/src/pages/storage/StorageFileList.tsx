import { ArrowDownToLine, Paperclip } from '@gravity-ui/icons';
import { Button, Icon, Loader, Table, Text } from '@gravity-ui/uikit';

import { StoredFileMeta } from '../../store/api';
import styles from '../StoragePage.module.css';
import { formatDate, formatSize } from './formatters';

interface StorageFileListProps {
  files: StoredFileMeta[];
  isLoading: boolean;
  isMobile: boolean;
  downloadingId: number | null;
  onDownload: (file: StoredFileMeta) => void;
}

export function StorageFileList({
  files,
  isLoading,
  isMobile,
  downloadingId,
  onDownload,
}: StorageFileListProps) {
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <>
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
                onClick={() => onDownload(file)}
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
                    onClick={() => onDownload(item)}
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
    </>
  );
}
