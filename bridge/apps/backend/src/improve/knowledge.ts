// A8 — knowledge that should outlive one task goes into the repository, not into a database: a rule written
// into CLAUDE.md (read by every agent that opens the repo) or docs/knowledge.md is versioned, reviewed in a
// pull request and always there, while a Context stays for the one-off. Nothing here accumulates by itself:
// every entry is a pull request the owner accepts (docs/roadmap.md explains why an agent-written memory is
// not done).
//
// This file is the pure part: where an entry goes and what the file looks like afterwards.

import { BadRequestException, ConflictException } from '@nestjs/common';

import { redactChatText } from '../logs/redact';

export const KNOWLEDGE_TARGETS = {
  // Read by every agent that works in the repository; the entry goes into one section at the end.
  'claude-md': { path: 'CLAUDE.md', heading: '## Постоянные знания' },
  // A file of its own, for what is too long or too specific for CLAUDE.md.
  docs: { path: 'docs/knowledge.md', heading: null },
} as const;

export type KnowledgeTarget = keyof typeof KNOWLEDGE_TARGETS;

export const MAX_TITLE_LENGTH = 160;
export const MAX_TEXT_LENGTH = 3000;

const DOCS_HEADER =
  '# Постоянные знания\n\nПравила и факты, которые проекту нужны всегда. Записаны из Questions и Context (A8) через pull request; правятся обычным PR.\n';

export interface KnowledgeEntry {
  title: string;
  text: string;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** The entry cleaned up, or a 400 saying why it cannot be kept. */
export function checkEntry(entry: KnowledgeEntry): KnowledgeEntry {
  const title = oneLine(entry.title);
  const text = entry.text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!title) throw new BadRequestException('У знания нет заголовка');
  if (!text) throw new BadRequestException('У знания нет текста');
  if (title.length > MAX_TITLE_LENGTH) {
    throw new BadRequestException(
      `Заголовок длиннее ${MAX_TITLE_LENGTH} символов`,
    );
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw new BadRequestException(`Текст длиннее ${MAX_TEXT_LENGTH} символов`);
  }
  // The repository is read by every worker and every model, and its history is forever.
  if (redactChatText(title) !== title || redactChatText(text) !== text) {
    throw new BadRequestException(
      'В тексте есть то, что похоже на ключ или пароль — в репозиторий такое не записывается',
    );
  }

  return { title, text };
}

/** `- **Title.** text`, a longer text continuing on indented lines (so it stays one list item). */
export function renderEntry({ title, text }: KnowledgeEntry): string {
  const mark = /[.?!:]$/.test(title) ? title : `${title}.`;
  const [first, ...rest] = text.split('\n');

  return [
    `- **${mark}** ${first}`,
    ...rest.map((line) => (line ? `  ${line}` : '')),
  ].join('\n');
}

function endWithNewline(text: string): string {
  return `${text.replace(/\n+$/, '')}\n`;
}

/** `current` (null: the file does not exist yet) with the entry added; 409 when it is already there. */
export function addKnowledge(
  current: string | null,
  target: KnowledgeTarget,
  entry: KnowledgeEntry,
): string {
  const bullet = renderEntry(entry);
  const { heading } = KNOWLEDGE_TARGETS[target];

  if (current !== null && current.includes(bullet)) {
    throw new ConflictException('Такое знание уже записано');
  }

  if (heading === null) {
    return current === null
      ? `${DOCS_HEADER}\n${bullet}\n`
      : `${endWithNewline(current)}\n${bullet}\n`;
  }

  const base = current ?? `# ${KNOWLEDGE_TARGETS[target].path}\n`;
  const lines = base.replace(/\n+$/, '').split('\n');
  const at = lines.findIndex((line) => line.trim() === heading);

  if (at === -1) {
    return `${lines.join('\n')}\n\n${heading}\n\n${bullet}\n`;
  }

  // The end of the section: the next "## " heading or the end of the file; the entry goes after its last line of text.
  let end = lines.findIndex((line, index) => index > at && /^## /.test(line));

  if (end === -1) end = lines.length;

  let last = end - 1;

  while (last > at && lines[last].trim() === '') last--;

  const before = lines.slice(0, last + 1);
  const after = lines.slice(last + 1);
  // A list item continues a list; anything else (the heading, a paragraph) needs a blank line before the first item.
  const gap = /^(\s*[-*+] |\s{2,}\S)/.test(lines[last]) ? [] : [''];

  return `${[...before, ...gap, bullet, ...after].join('\n')}\n`;
}

/** A branch name for the entry: `knowledge/<slug>-<stamp>`. */
export function knowledgeBranch(title: string, stamp: number): string {
  const slug = oneLine(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/, '');

  return `knowledge/${slug ? `${slug}-` : ''}${stamp.toString(36)}`;
}
