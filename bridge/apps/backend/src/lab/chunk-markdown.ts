// Structure-aware markdown chunking, the same spirit as a RAG ingestion pipeline (Groundwork's own
// chunk-text.ts): a fenced code block is kept atomic (never split, however long), headings start a new
// section carried forward until the next one, and a section too long for one chunk is only ever cut at a
// blank line (a paragraph boundary), never mid-paragraph or mid-fence.
//
// Known limits (unlike Groundwork's chunker): no special handling for YAML frontmatter or mermaid fences
// specifically (a mermaid block is still a fence, so it is still kept atomic) and no sentence-boundary
// splitting within an unbroken paragraph — a single very long paragraph with no blank line becomes one
// chunk regardless of size, capped at HARD_MAX_CHARS. Acceptable for a Lab project's own decision logs and
// specs, which this is sized for, not for ingesting arbitrary long-form prose.

export interface MarkdownChunk {
  heading: string | null;
  content: string;
}

const DEFAULT_MAX_CHARS = 1500;
// A safety cap on a single chunk regardless of structure (one giant fenced block, one giant paragraph) —
// protects the DB column and the TF-IDF ranking cost from a pathological file, not a normal content boundary.
const HARD_MAX_CHARS = 8000;
const TRUNCATION_NOTE = '\n\n…обрезано: раздел длиннее обычного.';

const FENCE_RE = /^(```|~~~)/;
const HEADING_RE = /^#{1,6}\s+(.+)$/;

function capLength(content: string): string {
  if (content.length <= HARD_MAX_CHARS) return content;

  return `${content.slice(0, HARD_MAX_CHARS - TRUNCATION_NOTE.length)}${TRUNCATION_NOTE}`;
}

export function chunkMarkdown(
  text: string,
  maxChars = DEFAULT_MAX_CHARS,
): MarkdownChunk[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const chunks: MarkdownChunk[] = [];
  let heading: string | null = null;
  let buffer: string[] = [];
  let inFence = false;

  const flush = () => {
    const content = capLength(buffer.join('\n').trim());

    if (content) chunks.push({ heading, content });
    buffer = [];
  };

  for (const line of lines) {
    if (FENCE_RE.test(line.trim())) inFence = !inFence;

    if (!inFence) {
      const headingMatch = HEADING_RE.exec(line);

      if (headingMatch) {
        flush();
        heading = headingMatch[1].trim();
        buffer.push(line);
        continue;
      }

      // A size-triggered flush only ever happens at a blank line (a paragraph boundary): the chunk after it
      // keeps the same `heading` — it is a continuation of the same section, not a new one.
      if (line.trim() === '' && buffer.join('\n').length >= maxChars) {
        flush();
        continue;
      }
    }

    buffer.push(line);
  }

  flush();

  return chunks;
}
