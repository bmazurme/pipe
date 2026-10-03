import { useState } from 'react';

import { PurgeEntry, useCreateEntryMutation } from '../../store/api';
import { parseImportedEntries } from './purgeUtils';

export function useDictionaryImportExport(entries: PurgeEntry[]) {
  const [createEntryTrigger] = useCreateEntryMutation();

  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const handleExport = () => {
    const data = entries.map(({ key, value }) => ({ key, value }));
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `purge-dictionary-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file: File) => {
    setIsImporting(true);
    setImportError(null);
    setImportMessage(null);

    try {
      const items = parseImportedEntries(await file.text());

      let imported = 0;
      let skipped = 0;

      // Sequential on purpose: key/value uniqueness is enforced by the
      // backend per request, so concurrent inserts could race each other.
      for (const item of items) {
        try {
          await createEntryTrigger({ key: item.key, value: item.value }).unwrap();
          imported += 1;
        } catch {
          skipped += 1;
        }
      }

      // A skip can now mean a duplicate key/value (our own dictionary rule)
      // or an empty value (ntlstl/purge allows one, our backend doesn't) —
      // no longer just duplicates, so the message stays generic.
      setImportMessage(
        skipped > 0
          ? `Импортировано: ${imported}, пропущено: ${skipped}`
          : `Импортировано: ${imported}`,
      );
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Не удалось прочитать файл');
    } finally {
      setIsImporting(false);
    }
  };

  return { isImporting, importMessage, importError, handleExport, handleImportFile };
}
