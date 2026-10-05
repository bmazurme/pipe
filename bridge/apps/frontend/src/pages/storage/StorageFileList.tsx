import {
  ArrowDownToLine,
  File,
  FileText,
  FileZipper,
  LockOpen,
  Picture,
  TrashBin,
} from '@gravity-ui/icons';
import { ActionTooltip, Button, Icon, IconData, Skeleton, Text } from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { isEncryptedFile } from '../../shared/lib/parcelCrypto';
import { StoredFileMeta } from '../../store/api';
import { EmptyState } from '../../widgets/EmptyState';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../StoragePage.module.css';
import { formatSize } from './formatters';

const EXTENSION_ICON: [RegExp, IconData][] = [
  [/\.(png|jpe?g|gif|webp|svg|avif|heic)$/i, Picture],
  [/\.(zip|rar|7z|tar|gz|bz2)$/i, FileZipper],
  [/\.(txt|md|csv|json|ya?ml|log|pdf|docx?)$/i, FileText],
];

function getFileIcon(name: string): IconData {
  return EXTENSION_ICON.find(([pattern]) => pattern.test(name))?.[1] ?? File;
}

const SKELETON_ROWS = [0, 1, 2];

interface StorageFileListProps {
  files: StoredFileMeta[];
  isLoading: boolean;
  isMobile: boolean;
  downloadingId: number | null;
  onDownload: (file: StoredFileMeta) => void;
  onOpenEncrypted: (file: StoredFileMeta) => void;
  onDeleteRequest: (file: StoredFileMeta) => void;
}

export function StorageFileList({
  files,
  isLoading,
  isMobile,
  downloadingId,
  onDownload,
  onOpenEncrypted,
  onDeleteRequest,
}: StorageFileListProps) {
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <>
      <SectionHeader
        title="Файлы"
        meta={files.length > 0 ? `${files.length} · ${formatSize(totalSize)}` : undefined}
      />

      {isLoading && (
        <ul className={styles.fileList}>
          {SKELETON_ROWS.map((row) => (
            <li key={row} className={styles.fileRow}>
              <Skeleton variant="circle" width={32} height={32} className={styles.fileIconSkeleton} />
              <div className={styles.fileInfo}>
                <Skeleton width="45%" height={16} />
                <Skeleton width="30%" height={12} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {!isLoading && files.length === 0 && (
        <EmptyState
          icon={File}
          title="Файлов пока нет"
          description="Перетащите файл в область выше, чтобы поделиться им между устройствами."
        />
      )}

      {/* One row layout for every width. The desktop table used to be a
          separate component tree, which is why it looked nothing like the
          devices list on the profile page. */}
      {!isLoading && files.length > 0 && (
        <ul className={styles.fileList}>
          {files.map((file) => (
            <li key={file.id} className={styles.fileRow}>
              <span className={styles.fileIcon}>
                <Icon data={getFileIcon(file.originalName)} size={16} />
              </span>

              <div className={styles.fileInfo}>
                <Text ellipsis title={file.originalName}>
                  {file.originalName}
                </Text>
                <Text color="secondary" variant="caption-2" ellipsis>
                  {formatSize(file.size)} · {formatRelativeTime(file.createdAt)}
                </Text>
              </div>

              {isEncryptedFile(file.originalName) && (
                <ActionTooltip
                  title="Открыть"
                  description="Расшифровать и скачать — исходный файл остаётся в Storage"
                >
                  <Button
                    view="flat"
                    aria-label={`Открыть ${file.originalName}`}
                    onClick={() => onOpenEncrypted(file)}
                  >
                    <Icon data={LockOpen} size={16} />
                    {!isMobile && 'Открыть'}
                  </Button>
                </ActionTooltip>
              )}

              <ActionTooltip
                title="Скачать"
                description="Файл удаляется с сервера сразу после скачивания"
              >
                <Button
                  view="flat"
                  aria-label={`Скачать ${file.originalName}`}
                  loading={downloadingId === file.id}
                  onClick={() => onDownload(file)}
                >
                  <Icon data={ArrowDownToLine} size={16} />
                  {!isMobile && 'Скачать'}
                </Button>
              </ActionTooltip>

              <ActionTooltip title="Удалить" description="Удалить без скачивания — с подтверждением">
                <Button
                  view="flat-danger"
                  aria-label={`Удалить ${file.originalName}`}
                  onClick={() => onDeleteRequest(file)}
                >
                  <Icon data={TrashBin} size={16} />
                  {!isMobile && 'Удалить'}
                </Button>
              </ActionTooltip>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
