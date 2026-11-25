export interface FilteredLog {
  // What to show: the matching lines, newline-joined (the whole log, untouched, for an empty query).
  text: string;
  matched: number;
  total: number;
}

// Splits a log into lines the way the header counts them: a trailing newline does not make an extra empty line.
function splitLines(logs: string): string[] {
  return logs ? logs.replace(/\n$/, '').split('\n') : [];
}

// Keeps only the lines that contain the query, case-insensitively. A blank query keeps the log as it is.
export function filterLogLines(logs: string, query: string): FilteredLog {
  const lines = splitLines(logs);
  const needle = query.trim().toLowerCase();

  if (!needle) return { text: logs, matched: lines.length, total: lines.length };

  const kept = lines.filter((line) => line.toLowerCase().includes(needle));

  return { text: kept.join('\n'), matched: kept.length, total: lines.length };
}
