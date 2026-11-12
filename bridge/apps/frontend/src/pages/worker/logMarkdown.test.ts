import { describe, expect, it } from 'vitest';

import { isServiceLine, logToMarkdown, MAX_RENDERED_CHARS } from './logMarkdown';

describe('logToMarkdown', () => {
  it('fences the worker status lines and leaves the reply text as markdown', () => {
    const { markdown, truncated } = logToMarkdown(
      'Claimed job 5 (model: opus)\nRunning claude --model opus...\n## Итог\n\nСделано **всё**.\nUploading result parcel (2 files, 0 binary assets)...\n',
    );

    expect(truncated).toBe(false);
    expect(markdown).toBe(
      [
        '',
        '```',
        'Claimed job 5 (model: opus)',
        'Running claude --model opus...',
        '```',
        '',
        '## Итог',
        '',
        'Сделано **всё**.',
        '',
        '```',
        'Uploading result parcel (2 files, 0 binary assets)...',
        '```',
        '',
      ].join('\n'),
    );
  });

  it('keeps a tool line literal even when it has markdown or backticks in it', () => {
    const { markdown } = logToMarkdown('[tool] bash({"cmd":"echo ```a_b_```"}) -> *ok*\n');

    expect(markdown).toBe('\n````\n[tool] bash({"cmd":"echo ```a_b_```"}) -> *ok*\n````\n');
  });

  it('does not touch status-looking lines inside the reply\'s own code block', () => {
    const reply = 'Пример:\n```\nFailed: boom\nRunning x\n```\nготово';
    const { markdown } = logToMarkdown(`${reply}\n`);

    expect(markdown).toBe(reply);
  });

  it('keeps only the tail of a very long log and says so', () => {
    const line = 'строка лога номер один\n';
    const { markdown, truncated } = logToMarkdown(line.repeat(Math.ceil((MAX_RENDERED_CHARS * 2) / line.length)));

    expect(truncated).toBe(true);
    expect(markdown.length).toBeLessThanOrEqual(MAX_RENDERED_CHARS);
    expect(markdown.startsWith('строка лога номер один')).toBe(true);
  });

  it('recognises the worker prefixes', () => {
    expect(isServiceLine('Failed: x')).toBe(true);
    expect(isServiceLine('Time limit extended to 7200s')).toBe(true);
    expect(isServiceLine('Failed tests are listed below')).toBe(false);
    expect(isServiceLine('Нормальный текст')).toBe(false);
    expect(isServiceLine('Running the tests now')).toBe(false);
    expect(isServiceLine('Time limit is a soft one')).toBe(false);
  });
});
