import { useRef, useState } from 'react';
import { Alert, Button, Disclosure, Loader, Text } from '@gravity-ui/uikit';

import { usePeekJobResultMutation } from '../../store/api';
import styles from '../WorkerPage.module.css';
import { listResultFiles, readResultText, type ResultFile } from './resultFiles';

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
          ) : (
            <pre aria-label={`Содержимое ${selected}`} style={{ maxHeight: 300, overflow: 'auto', margin: 0 }}>
              {preview}
            </pre>
          ))}
      </div>
    </Disclosure>
  );
}
