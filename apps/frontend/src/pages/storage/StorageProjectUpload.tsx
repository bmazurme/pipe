import { ChangeEvent, useRef, useState } from 'react';
import { FolderCode } from '@gravity-ui/icons';
import { Button, Card, Icon, Progress, SegmentedRadioGroup, Text } from '@gravity-ui/uikit';

import { MAX_FILE_SIZE_BYTES, useListEntriesQuery } from '../../store/api';
import { storageApiEndpoints } from '../../store/api/storage-api/endpoints';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { purgeEntriesSelector } from '../../store/slices';
import { buildDictionary, Direction } from '../purge/purgeUtils';
import { formatSize } from './formatters';
import { buildProjectZip, deriveZipName } from './projectZip';
import styles from '../StoragePage.module.css';
import { uploadZipWithProgress } from './uploadZipWithProgress';

type Phase = 'idle' | 'preparing' | 'uploading';

const PREPARE_WEIGHT = 0.8;

// webkitdirectory/directory aren't in React's DOM typings — spread as an
// untyped attribute bag instead of augmenting InputHTMLAttributes globally.
const directoryInputProps = { webkitdirectory: '', directory: '' } as Record<string, string>;

export function StorageProjectUpload({ onError }: { onError: (message: string | null) => void }) {
  const dispatch = useAppDispatch();
  useListEntriesQuery();
  const entries = useAppSelector(purgeEntriesSelector);
  const accessToken = useAppSelector((state) => state.auth.accessToken);

  const [direction, setDirection] = useState<Direction>('keyToValue');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isBusy = phase !== 'idle';

  const handleFiles = async (files: File[]) => {
    onError(null);
    setSummary(null);
    setPhase('preparing');
    setProgress(0);

    try {
      const dictionary = buildDictionary(entries, direction);
      const { blob, fileCount, excludedCount, replacedCount } = await buildProjectZip(
        files,
        dictionary,
        (fraction) => setProgress(Math.round(fraction * PREPARE_WEIGHT * 100)),
      );

      if (blob.size > MAX_FILE_SIZE_BYTES) {
        throw new Error(
          `Архив превышает лимит ${formatSize(MAX_FILE_SIZE_BYTES)} (получилось ${formatSize(blob.size)})`,
        );
      }

      setPhase('uploading');
      const filename = deriveZipName(files);
      await uploadZipWithProgress(blob, filename, accessToken, (fraction) =>
        setProgress(Math.round(PREPARE_WEIGHT * 100 + fraction * (1 - PREPARE_WEIGHT) * 100)),
      );

      dispatch(storageApiEndpoints.util.invalidateTags(['Storage']));

      const parts = [`файлов: ${fileCount}`];
      if (excludedCount > 0) parts.push(`исключено: ${excludedCount}`);
      if (replacedCount > 0) parts.push(`замен по словарю: ${replacedCount}`);
      setSummary(`«${filename}» загружен · ${parts.join(', ')}`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Не удалось загрузить проект');
    } finally {
      setPhase('idle');
      setProgress(0);
    }
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    // Snapshot into a plain array before clearing value — resetting a file
    // input's value live-mutates the same FileList the browser handed back,
    // so reading it after (even just for .length) sees it already emptied.
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    if (files.length > 0) void handleFiles(files);
  };

  return (
    <Card view="outlined" className={styles.filesCard}>
      <Text variant="subheader-2">Загрузить проект</Text>
      <Text color="secondary" variant="body-1" className={styles.projectHint}>
        Папка упаковывается в zip прямо в браузере: node_modules, .git, dist,
        build, .next, coverage и .env-файлы исключаются, а к остальным
        текстовым файлам применяется словарь Purge.
      </Text>

      <div className={styles.projectForm}>
        <SegmentedRadioGroup
          value={direction}
          onUpdate={(value) => setDirection(value as Direction)}
          width="max"
          disabled={isBusy}
        >
          <SegmentedRadioGroup.Option value="keyToValue">
            Ключ → значение
          </SegmentedRadioGroup.Option>
          <SegmentedRadioGroup.Option value="valueToKey">
            Значение → ключ
          </SegmentedRadioGroup.Option>
        </SegmentedRadioGroup>

        <Button
          view="outlined-action"
          size="l"
          loading={isBusy}
          onClick={() => inputRef.current?.click()}
        >
          <Icon data={FolderCode} size={16} />
          Выбрать папку проекта
        </Button>

        {isBusy && (
          <Progress
            value={progress}
            text={phase === 'preparing' ? 'Подготовка архива…' : 'Загрузка на сервер…'}
            size="m"
          />
        )}

        {summary && !isBusy && <Text color="secondary">{summary}</Text>}
      </div>

      <input
        ref={inputRef}
        type="file"
        hidden
        multiple
        onChange={handleChange}
        {...directoryInputProps}
      />
    </Card>
  );
}
