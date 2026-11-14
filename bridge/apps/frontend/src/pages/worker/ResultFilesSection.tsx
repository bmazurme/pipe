import { lazy, Suspense, useRef, useState } from 'react';
import { Alert, Button, Disclosure, Label, Loader, SegmentedRadioGroup, Switch, Text } from '@gravity-ui/uikit';

import { usePeekFileMutation, usePeekJobResultMutation } from '../../store/api';
import styles from '../WorkerPage.module.css';
import { compareWithSource, isMarkdownFile, lineDiff, listResultFiles, readResultText, readSourceText, type DiffLine, type ComparedFile, type ResultFile } from './resultFiles';

// Loaded on first use: the markdown pipeline is large and most job dialogs never open a .md result.
const MarkdownRenderer = lazy(() => import('@gravity-ui/aikit').then((module) => ({ default: module.MarkdownRenderer })));

interface ResultFilesSectionProps {
  jobId: number;
  sourceFileId?: number | null;
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} КБ`;

  return `${(size / (1024 * 1024)).toFixed(1)} МБ`;
}

export function ResultFilesSection({ jobId, sourceFileId = null }: ResultFilesSectionProps) {
  const [peekFile] = usePeekFileMutation();
  const [deleted, setDeleted] = useState<string[]>([]);
  const [compared, setCompared] = useState(false);
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [peekJobResult] = usePeekJobResultMutation();
  const bytesRef = useRef<Uint8Array | null>(null);
  const sourceRef = useRef<Uint8Array | null>(null);
  const requested = useRef(false);
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<(ResultFile | ComparedFile)[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  // A .md result opens formatted (that is how it is read); the source stays one click away.
  const [showSource, setShowSource] = useState(false);
  const [diff, setDiff] = useState<DiffLine[] | null>(null);
  const [showWhole, setShowWhole] = useState(false);

  // Fetched once, on the first expansion — not on dialog open or on every job poll.
  const load = async () => {
    setLoading(true);

    try {
      const blob = await peekJobResult(jobId).unwrap();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      bytesRef.current = bytes;
      let result: (ResultFile | ComparedFile)[] | null = null;

      if (sourceFileId !== null) {
        // Any failure (gone, encrypted, not a zip) silently falls back to the plain list.
        try {
          const source = new Uint8Array(await (await peekFile(sourceFileId).unwrap()).arrayBuffer());
          sourceRef.current = source;
          const diff = compareWithSource(bytes, source);
          result = diff.files;
          setDeleted(diff.deleted);
          setCompared(true);
        } catch {
          result = null;
        }
      }

      setFiles(result ?? listResultFiles(bytes));
    } catch (err) {
      requested.current = false;
      setError(typeof err === 'string' ? err : 'Не удалось прочитать файлы результата');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = (expanded: boolean) => {
    if (!expanded || requested.current) return;
    requested.current = true;
    void load();
  };

  const handleSelect = (path: string) => {
    setSelected(path);
    setShowSource(false);
    setShowWhole(false);

    const text = bytesRef.current ? readResultText(bytesRef.current, path) : null;
    const modified = files?.some((file) => file.path === path && 'change' in file && file.change === 'modified');
    const old = modified && text !== null && sourceRef.current ? readSourceText(sourceRef.current, path) : null;

    setPreview(text);
    setDiff(text !== null && old !== null ? lineDiff(old, text) : null);
  };

  const visibleFiles =
    compared && onlyChanged ? files?.filter((file) => !('change' in file) || file.change !== 'unchanged') : files;

  return (
    <Disclosure summary="Файлы результата" className={styles.encryptSection} onUpdate={handleUpdate}>
      <div className={styles.encryptBody}>
        {loading && <Loader size="s" />}
        {error && <Alert theme="danger" view="filled" message={error} />}
        {files && files.length === 0 && (
          <Text variant="body-2" color="secondary">
            Файлов нет
          </Text>
        )}
        {files && compared && (
          <>
            <Text variant="body-2">
              Изменено {files.filter((file) => 'change' in file && file.change !== 'unchanged').length} из {files.length} файлов
            </Text>
            <Switch checked={onlyChanged} onUpdate={setOnlyChanged} content="Только изменённые" />
            {deleted.length > 0 && (
              <Text variant="body-2" color="secondary">
                Удалены: {deleted.join(', ')}
              </Text>
            )}
          </>
        )}
        {visibleFiles?.map((file) => (
          <Button key={file.path} view={file.path === selected ? 'normal' : 'flat'} onClick={() => handleSelect(file.path)}>
            {file.path} ({formatSize(file.size)})
            {'change' in file && file.change !== 'unchanged' && (
              <Label size="xs" theme={file.change === 'added' ? 'success' : 'warning'}>
                {file.change === 'added' ? 'новый' : 'изменён'}
              </Label>
            )}
          </Button>
        ))}
        {selected !== null && preview !== null && diff !== null && (
          <SegmentedRadioGroup
            size="s"
            value={showWhole ? 'whole' : 'diff'}
            onUpdate={(value) => setShowWhole(value === 'whole')}
            aria-label="Режим просмотра"
          >
            <SegmentedRadioGroup.Option value="diff">Изменения</SegmentedRadioGroup.Option>
            <SegmentedRadioGroup.Option value="whole">Файл целиком</SegmentedRadioGroup.Option>
          </SegmentedRadioGroup>
        )}
        {selected !== null &&
          (preview === null ? (
            <Text variant="body-2" color="secondary">
              Не показать — скачайте результат
            </Text>
          ) : diff !== null && !showWhole ? (
            <pre aria-label={`Изменения ${selected}`} className={styles.resultPreview}>
              {diff.map((line, index) => (
                <div
                  key={index}
                  className={line.kind === '+' ? styles.diffAdded : line.kind === '-' ? styles.diffRemoved : undefined}
                >
                  {line.kind} {line.text}
                </div>
              ))}
            </pre>
          ) : isMarkdownFile(selected) ? (
            <>
              <SegmentedRadioGroup
                size="s"
                value={showSource ? 'source' : 'rendered'}
                onUpdate={(value) => setShowSource(value === 'source')}
                aria-label="Вид файла"
              >
                <SegmentedRadioGroup.Option value="rendered">Просмотр</SegmentedRadioGroup.Option>
                <SegmentedRadioGroup.Option value="source">Исходник</SegmentedRadioGroup.Option>
              </SegmentedRadioGroup>
              {showSource ? (
                <pre aria-label={`Содержимое ${selected}`} className={styles.resultPreview}>
                  {preview}
                </pre>
              ) : (
                <div role="region" aria-label={`Содержимое ${selected}`} className={styles.resultMarkdown}>
                  <Suspense fallback={<Loader size="s" />}>
                    <MarkdownRenderer content={preview} openLinksInNewTab />
                  </Suspense>
                </div>
              )}
            </>
          ) : (
            <pre aria-label={`Содержимое ${selected}`} className={styles.resultPreview}>
              {preview}
            </pre>
          ))}
      </div>
    </Disclosure>
  );
}
