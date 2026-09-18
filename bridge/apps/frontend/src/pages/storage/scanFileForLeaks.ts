import { scanForLeaks, type LeakFinding } from '@pipe/protocol/leakScan';

import type { PurgeEntry } from '../../store/api';
import { applyDictionary, buildDictionary } from '../purge/purgeUtils';
import { isTextFile } from './textFiles';

export interface FileLeakFindings {
  source: string;
  patternFindings: LeakFinding[];
  /** Real secret values (dictionary keys) still present in cleartext. */
  dictionaryHits: number;
}

// Only the "upload a project folder" path (projectZip.ts) applies the Purge
// dictionary before upload — a plain file dropped on Storage goes up
// untouched. This is the check that closes that gap: two independent
// things, both run against the file's own content before it leaves the
// machine. Neither depends on the other, so a file with no Purge entries
// configured still gets the pattern scan, and a file that doesn't match any
// heuristic pattern still gets checked against the dictionary.
export async function scanFileForLeaks(
  file: File,
  entries: PurgeEntry[],
): Promise<FileLeakFindings | null> {
  if (!isTextFile(file.name)) return null;

  const text = await file.text();
  const patternFindings = scanForLeaks([{ source: file.name, content: text }]);

  // toRemote direction: dictionary keys are the real values — if any is
  // still found verbatim, this file was never run through Purge.
  const dictionaryHits =
    entries.length > 0
      ? applyDictionary(text, buildDictionary(entries, 'keyToValue')).count
      : 0;

  if (patternFindings.length === 0 && dictionaryHits === 0) return null;

  return { source: file.name, patternFindings, dictionaryHits };
}

export async function scanFilesForLeaks(
  files: File[],
  entries: PurgeEntry[],
): Promise<FileLeakFindings[]> {
  const results = await Promise.all(files.map((file) => scanFileForLeaks(file, entries)));
  return results.filter((result): result is FileLeakFindings => result !== null);
}
