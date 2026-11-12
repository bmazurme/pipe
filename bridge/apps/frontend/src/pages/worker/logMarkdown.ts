// Turns a job log into markdown for reading. The log is two things written into one stream: the worker's own status
// lines ("Claimed job 5", "[tool] …", "Failed: …") and the model's reply text, which is markdown. Reply text is passed
// through; the status lines are fenced as code so they keep their line breaks and their `_`/`*` stay literal.

// Rendering re-parses the whole text on every poll, so a very long log shows its tail only (the raw view has it all).
export const MAX_RENDERED_CHARS = 150_000;

const SERVICE_LINE =
  /^(\[tool\]|\[… \d+ chars|Claimed job \d+|Attached context:|Time limit(?::| extended)|Route to \S+: |Running .*\.\.\.$|Open questions reported|Uploading result parcel|Failed:|Stopped by the owner|Partial result saved|Stop requested|Worker is shutting down|Before the time limit)/;

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

export function isServiceLine(line: string): boolean {
  return SERVICE_LINE.test(line);
}

// A fence longer than any run of backticks inside it cannot be closed early by the log's own text.
function fenceFor(lines: string[]): string {
  const longest = lines.reduce((max, line) => Math.max(max, ...(line.match(/`+/g) ?? ['']).map((run) => run.length)), 0);

  return '`'.repeat(Math.max(3, longest + 1));
}

export function logToMarkdown(logs: string): { markdown: string; truncated: boolean } {
  let text = logs.replace(/\r\n/g, '\n');
  let truncated = false;

  if (text.length > MAX_RENDERED_CHARS) {
    const cut = text.indexOf('\n', text.length - MAX_RENDERED_CHARS);

    text = cut === -1 ? text.slice(-MAX_RENDERED_CHARS) : text.slice(cut + 1);
    truncated = true;
  }

  const out: string[] = [];
  let service: string[] = [];
  // The reply's own code block: status-looking lines inside it are the reply's text, not the worker's.
  let openFence: { char: string; length: number } | null = null;

  const flush = () => {
    if (service.length === 0) return;
    const fence = fenceFor(service);

    out.push('', fence, ...service, fence, '');
    service = [];
  };

  for (const line of text.replace(/\n$/, '').split('\n')) {
    const fence = FENCE.exec(line);

    if (openFence) {
      out.push(line);

      if (fence && fence[1][0] === openFence.char && fence[1].length >= openFence.length && line.trim() === fence[1]) {
        openFence = null;
      }
    } else if (fence) {
      flush();
      out.push(line);
      openFence = { char: fence[1][0], length: fence[1].length };
    } else if (isServiceLine(line)) {
      service.push(line);
    } else {
      flush();
      out.push(line);
    }
  }

  flush();

  return { markdown: out.join('\n'), truncated };
}
