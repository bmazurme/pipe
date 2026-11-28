import { BadRequestException, ConflictException } from '@nestjs/common';

import {
  addKnowledge,
  checkEntry,
  knowledgeBranch,
  renderEntry,
} from './knowledge';

const entry = {
  title: 'Порт reports',
  text: 'Сервер слушает :4000, клиент :5174.',
};

describe('checkEntry', () => {
  it('collapses the title to one line and tidies the text', () => {
    expect(
      checkEntry({
        title: '  Порт \n reports ',
        text: 'a  \r\n\r\n\r\n\r\nb\n',
      }),
    ).toEqual({ title: 'Порт reports', text: 'a\n\nb' });
  });

  it.each([
    [{ title: ' ', text: 'x' }, /нет заголовка/],
    [{ title: 'x', text: ' \n ' }, /нет текста/],
    [{ title: 'x'.repeat(161), text: 'x' }, /Заголовок длиннее/],
    [{ title: 'x', text: 'x'.repeat(3001) }, /Текст длиннее/],
    [
      { title: 'x', text: 'ключ ghp_AbCdEfGhIjKlMnOpQrSt1234' },
      /похоже на ключ/,
    ],
    [{ title: 'sk-ant-api03-AbCdEfGhIjKlMn', text: 'x' }, /похоже на ключ/],
  ])('refuses %j', (input, message) => {
    expect(() => checkEntry(input)).toThrow(BadRequestException);
    expect(() => checkEntry(input)).toThrow(message);
  });

  it('keeps prose that only mentions a token', () => {
    expect(() =>
      checkEntry({ title: 'token: refresh', text: 'password: не подходит' }),
    ).not.toThrow();
  });
});

describe('renderEntry', () => {
  it('makes a bold title and the text', () => {
    expect(renderEntry(entry)).toBe(
      '- **Порт reports.** Сервер слушает :4000, клиент :5174.',
    );
  });

  it('does not double the punctuation of a title that is a question', () => {
    expect(renderEntry({ title: 'Какой порт?', text: ':4000' })).toBe(
      '- **Какой порт?** :4000',
    );
  });

  it('keeps a longer text inside the list item', () => {
    expect(renderEntry({ title: 'T', text: 'one\ntwo\n\nthree' })).toBe(
      '- **T.** one\n  two\n\n  three',
    );
  });
});

describe('addKnowledge — CLAUDE.md', () => {
  const bullet = renderEntry(entry);

  it('adds the section at the end when there is none', () => {
    expect(addKnowledge('# CLAUDE.md\n\nText.\n', 'claude-md', entry)).toBe(
      `# CLAUDE.md\n\nText.\n\n## Постоянные знания\n\n${bullet}\n`,
    );
  });

  it('adds to the end of the section when it is the last one, after the previous entry', () => {
    const current = '# X\n\n## Постоянные знания\n\n- **Старое.** да\n';

    expect(addKnowledge(current, 'claude-md', entry)).toBe(
      `# X\n\n## Постоянные знания\n\n- **Старое.** да\n${bullet}\n`,
    );
  });

  it('adds before the next section when the section is in the middle', () => {
    const current =
      '# X\n\n## Постоянные знания\n\n- **Старое.** да\n\n## Другое\n\nтекст\n';

    expect(addKnowledge(current, 'claude-md', entry)).toBe(
      `# X\n\n## Постоянные знания\n\n- **Старое.** да\n${bullet}\n\n## Другое\n\nтекст\n`,
    );
  });

  it('starts the list after an empty section, and after a paragraph with a blank line', () => {
    expect(
      addKnowledge('# X\n\n## Постоянные знания\n', 'claude-md', entry),
    ).toBe(`# X\n\n## Постоянные знания\n\n${bullet}\n`);
    expect(
      addKnowledge(
        '# X\n\n## Постоянные знания\n\nВводный абзац.\n',
        'claude-md',
        entry,
      ),
    ).toBe(`# X\n\n## Постоянные знания\n\nВводный абзац.\n\n${bullet}\n`);
  });

  it('creates the file when it does not exist', () => {
    expect(addKnowledge(null, 'claude-md', entry)).toBe(
      `# CLAUDE.md\n\n## Постоянные знания\n\n${bullet}\n`,
    );
  });

  it('refuses an entry that is already there', () => {
    const once = addKnowledge('# X\n', 'claude-md', entry);

    expect(() => addKnowledge(once, 'claude-md', entry)).toThrow(
      ConflictException,
    );
  });
});

describe('addKnowledge — docs/knowledge.md', () => {
  it('creates the file with its header', () => {
    const out = addKnowledge(null, 'docs', entry);

    expect(out.startsWith('# Постоянные знания\n\n')).toBe(true);
    expect(out.endsWith(`${renderEntry(entry)}\n`)).toBe(true);
  });

  it('appends to an existing file', () => {
    const first = addKnowledge(null, 'docs', entry);
    const second = addKnowledge(first, 'docs', { title: 'Ещё', text: 'да' });

    expect(second).toBe(`${first}\n- **Ещё.** да\n`);
  });
});

describe('knowledgeBranch', () => {
  it('is a slug of the title and a stamp', () => {
    expect(knowledgeBranch('Port reports: 4000!', 1000)).toBe(
      'knowledge/port-reports-4000-rs',
    );
  });

  it('works for a title with no latin letters', () => {
    expect(knowledgeBranch('Порт', 36)).toBe('knowledge/10');
  });

  it('keeps the slug short', () => {
    expect(knowledgeBranch('a'.repeat(100), 1).length).toBeLessThanOrEqual(
      'knowledge/'.length + 30 + 1 + 6,
    );
  });
});
