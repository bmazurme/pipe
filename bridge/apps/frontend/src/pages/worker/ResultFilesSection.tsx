import { lazy, Suspense, useRef, useState } from 'react';
import { Alert, Button, Disclosure, Loader, SegmentedRadioGroup, Text } from '@gravity-ui/uikit';

import { usePeekJobResultMutation } from '../../store/api';
import styles from '../WorkerPage.module.css';
import { isMarkdownFile, listResultFiles, readResultText, type ResultFile } from './resultFiles';

// Loaded on first use: the markdown pipeline is large and most job dialogs never open a .md result.
const MarkdownRenderer = lazy(() => import('@gravity-ui/aikit').then((module) => ({ default: module.MarkdownRenderer })));

interface ResultFilesSectionProps {
  jobId: number;
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} КБ`;

  return `${(size / (1024 * 1024)).toFixed(1)} МБ`;
}

export function ResultFilesSection({ jobId }: ResultFilesSectionProps) {
  const [peekJobResult] = usePeekJobResultMutation();
  const bytesRef = useRef<Uint8Array | null>(null);
  const requested = useRef(false);
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<ResultFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  // A .md result opens formatted (that is how it is read); the source stays one click away.
  const [showSource, setShowSource] = useState(false);

  // Fetched once, on the first expansion — not on dialog open or on every job poll.
  const load = async () => {
    setLoading(true);

    try {
      const blob = await peekJobResult(jobId).unwrap();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      bytesRef.current = bytes;
      setFiles(listResultFiles(bytes));
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
    setPreview(bytesRef.current ? readResultText(bytesRef.current, path) : null);
  };

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
        {files?.map((file) => (
          <Button key={file.path} view={file.path === selected ? 'normal' : 'flat'} onClick={() => handleSelect(file.path)}>
            {file.path} ({formatSize(file.size)})
          </Button>
        ))}
        {selected !== null &&
          (preview === null ? (
            <Text variant="body-2" color="secondary">
              Не показать — скачайте результат
            </Text>
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
