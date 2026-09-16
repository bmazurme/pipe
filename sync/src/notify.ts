import { execFile } from 'node:child_process';
import { platform } from 'node:os';

// Split out so it's testable without spawning a real notifier or firing an
// actual OS notification during `npm test` (see notify.test.ts) — the
// dispatch logic below is exercised only by inspection.
export function formatFallback(title: string, message: string): string {
  return `\n\u{1F514} ${title}: ${message}\n`;
}

// Best-effort OS notification for gitlab-worker / pull-issue --watch: "a
// result is ready, you don't have to keep polling by hand." execFile (not
// exec/a shell string) so an arbitrary GitLab issue title in the message
// can never be interpreted as shell syntax. Never throws — a failed
// notification must not break the push/pull it's reporting on.
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
