const MAX_BASE_LENGTH = 80;

/** A safe `.md` file name for a saved context; `context-<id>.md` when nothing usable is left of the name. */
export function contextFilename(name: string, id: number): string {
  const base = name
    // eslint-disable-next-line no-control-regex
    .replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_BASE_LENGTH)
    .trim()
    // a name made only of dots/punctuation is not a usable file name
    .replace(/^\.+|\.+$/g, '')
    .trim();

  return /[\p{L}\p{N}]/u.test(base) ? `${base}.md` : `context-${id}.md`;
}
