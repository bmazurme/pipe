import { useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  File,
  FileText,
  FileZipper,
  LockOpen,
  Magnifier,
  Picture,
  TrashBin,
} from '@gravity-ui/icons';
import {
  ActionTooltip,
  Alert,
  Button,
  Icon,
  IconData,
  SegmentedRadioGroup,
  Skeleton,
  Text,
  TextInput,
} from '@gravity-ui/uikit';

import { formatRelativeTime } from '../../shared/lib/formatRelativeTime';
import { isEncryptedFile } from '../../shared/lib/parcelCrypto';
import { getErrorMessage, StoredFileMeta } from '../../store/api';
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

type DirectionFilter = 'all' | 'outbound' | 'result';

const DIRECTION_LABEL = {
  outbound: '→ задача',
  result: '← результат',
} as const;

function getParcelCaption(file: StoredFileMeta): string {
  const parts: string[] = [];
  if (file.direction) parts.push(DIRECTION_LABEL[file.direction]);
  if (file.taskKey) parts.push(file.taskKey);
  return parts.join(' · ');
}

interface StorageFileListProps {
  files: StoredFileMeta[];
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  onRetry: () => void;
  isMobile: boolean;
  downloadingId: number | null;
  onDownload: (file: StoredFileMeta) => void;
  onOpenEncrypted: (file: StoredFileMeta) => void;
  onDeleteRequest: (file: StoredFileMeta) => void;
}

export function StorageFileList({
  files,
  isLoading,
  isError,
  error,
  onRetry,
  isMobile,
  downloadingId,
  onDownload,
  onOpenEncrypted,
  onDeleteRequest,
}: StorageFileListProps) {
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  const [direction, setDirection] = useState<DirectionFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const visibleFiles = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return files.filter((file) => {
      if (direction !== 'all' && file.direction !== direction) return false;
      if (!query) return true;
      return (
        file.originalName.toLowerCase().includes(query) ||
        (file.taskKey ?? '').toLowerCase().includes(query)
      );
    });
  }, [files, direction, searchQuery]);

  return (
    <>
      <SectionHeader
        title="Файлы"
        meta={files.length > 0 ? `${files.length} · ${formatSize(totalSize)}` : undefined}
      />

      {!isLoading && !isError && files.length > 0 && (
        <div className={styles.fileFilters}>
          <SegmentedRadioGroup
            value={direction}
            onUpdate={(value) => setDirection(value as DirectionFilter)}
          >
            <SegmentedRadioGroup.Option value="all">Все</SegmentedRadioGroup.Option>
            <SegmentedRadioGroup.Option value="outbound">Задачи</SegmentedRadioGroup.Option>
            <SegmentedRadioGroup.Option value="result">Результаты</SegmentedRadioGroup.Option>
          </SegmentedRadioGroup>
          <TextInput
            value={searchQuery}
            onUpdate={setSearchQuery}
            placeholder="Поиск по имени и задаче"
            controlProps={{ 'aria-label': 'Поиск по файлам' }}
            hasClear
            startContent={<Icon data={Magnifier} size={16} />}
          />
        </div>
      )}

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

      {isError && !isLoading && (
        <Alert
          theme="danger"
          view="filled"
          title="Не удалось загрузить список файлов"
          message={getErrorMessage(error, 'Сервер недоступен или вернул ошибку')}
          actions={<Button onClick={onRetry}>Повторить</Button>}
        />
      )}

      {!isLoading && !isError && files.length === 0 && (
        <EmptyState
          icon={File}
          title="Файлов пока нет"
          description="Перетащите файл в область выше, чтобы поделиться им между устройствами."
        />
      )}

      {!isLoading && !isError && files.length > 0 && visibleFiles.length === 0 && (
        <EmptyState
          icon={Magnifier}
          title="Ничего не найдено"
          description="Попробуйте другой запрос или смените фильтр."
        />
      )}

      {/* One row layout for every width. The desktop table used to be a
          separate component tree, which is why it looked nothing like the
          devices list on the profile page. */}
      {!isLoading && visibleFiles.length > 0 && (
        <ul className={styles.fileList}>
          {visibleFiles.map((file) => (
            <li key={file.id} className={styles.fileRow}>
              <span className={styles.fileIcon}>
                <Icon data={getFileIcon(file.originalName)} size={16} />
              </span>

              <div className={styles.fileInfo}>
                <Text ellipsis title={file.originalName}>
                  {file.originalName}
                </Text>
                <Text color="secondary" variant="caption-2" ellipsis>
                  {[getParcelCaption(file), formatSize(file.size), formatRelativeTime(file.createdAt)]
                    .filter(Boolean)
                    .join(' · ')}
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
