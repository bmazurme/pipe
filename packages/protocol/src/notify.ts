import { execFile } from 'node:child_process';
import { platform } from 'node:os';

// Shared with harness (IMPROVEMENTS_HARNESS.md 3.1) — originally sync-only
// (gitlab-worker / pull-issue --watch: "a result is ready, you don't have
// to keep polling by hand"), moved here rather than duplicated a second
// time. The fallback uses console.log directly instead of sync's own
// leveled log.ts — a shared module has no business depending on one
// product's CLI-output conventions.

// Split out so it's testable without spawning a real notifier or firing an
// actual OS notification during `npm test` — the dispatch logic below is
// exercised only by inspection.
export function formatFallback(title: string, message: string): string {
  return `\n\u{1F514} ${title}: ${message}\n`;
}

// Best-effort OS notification. execFile (not exec/a shell string) so an
// arbitrary issue title in the message can never be interpreted as shell
// syntax. Never throws — a failed notification must not break whatever
// it's reporting on.
export function notify(title: string, message: string): void {
  const fallback = () => console.log(formatFallback(title, message));

  try {
    if (platform() === 'darwin') {
      const script = `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`;
      execFile('osascript', ['-e', script], (error) => {
        if (error) fallback();
      });
      return;
    }

    if (platform() === 'linux') {
      execFile('notify-send', [title, message], (error) => {
        if (error) fallback();
      });
      return;
    }

    fallback();
  } catch {
    fallback();
  }
}
