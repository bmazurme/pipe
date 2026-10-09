import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import type { ChatHistoryEntry } from '../chatBridgeClient.js';
import { attachmentRelPath, safeAttachmentName, stageAttachments } from './chatAttachments.js';
import { buildPrompt } from './claudeChat.js';

const dirs: string[] = [];
const tmp = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'chat-att-'));
  dirs.push(dir);

  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('safeAttachmentName', () => {
  it('keeps a normal name, prefixed with the id so names stay unique', () => {
    assert.equal(safeAttachmentName({ id: 7, name: 'screenshot.png' }), '7-screenshot.png');
  });

  it('cannot escape the attachments directory', () => {
    for (const name of ['../../etc/passwd', '..\\..\\boot.ini', '/abs/path.txt', '....//x.md']) {
      const safe = safeAttachmentName({ id: 1, name });

      assert.ok(!safe.includes('/') && !safe.includes('\\'), safe);
      assert.ok(!safe.startsWith('.'), safe);
    }
  });

  it('replaces control characters and bounds the length', () => {
    assert.equal(safeAttachmentName({ id: 2, name: 'a\u0000b\nc.txt' }), '2-a_b_c.txt');
    assert.ok(safeAttachmentName({ id: 3, name: `${'x'.repeat(500)}.png` }).length <= 124);
  });

  it('falls back to a placeholder for an empty name', () => {
    assert.equal(safeAttachmentName({ id: 4, name: '' }), '4-file');
  });
});

describe('stageAttachments', () => {
  const history: ChatHistoryEntry[] = [
    { role: 'user', content: 'look', attachments: [{ id: 1, name: 'a.png', size: 3, isImage: true }, { id: 2, name: 'b.txt', size: 2, isImage: false }] },
    { role: 'assistant', content: 'ok' },
  ];

  it('writes every attached file under attachments/ and reports what it staged', async () => {
    const dir = tmp();

    const staged = await stageAttachments(dir, history, async (id) => Buffer.from(`file-${id}`));

    assert.deepEqual([...staged].sort(), [1, 2]);
    assert.equal(readFileSync(path.join(dir, attachmentRelPath({ id: 1, name: 'a.png' })), 'utf8'), 'file-1');
    assert.equal(readFileSync(path.join(dir, attachmentRelPath({ id: 2, name: 'b.txt' })), 'utf8'), 'file-2');
  });

  it('creates nothing when no message has a file', async () => {
    const dir = tmp();

    const staged = await stageAttachments(dir, [{ role: 'user', content: 'hi' }], async () => Buffer.from('x'));

    assert.equal(staged.size, 0);
    assert.equal(existsSync(path.join(dir, 'attachments')), false);
  });

  it('skips a file it cannot download instead of failing the turn', async () => {
    const dir = tmp();

    const staged = await stageAttachments(dir, history, async (id) => {
      if (id === 1) throw new Error('404');

      return Buffer.from('ok');
    });

    assert.deepEqual([...staged], [2]);
  });
});

describe('buildPrompt with attachments', () => {
  const history: ChatHistoryEntry[] = [
    { role: 'user', content: 'what is wrong here?', attachments: [{ id: 5, name: 'err.png', size: 3, isImage: true }] },
  ];

  it('points Claude at each staged file and tells it to open them', () => {
    const prompt = buildPrompt(history, new Set([5]));

    assert.match(prompt, /User: what is wrong here\?\n\[attached image: attachments\/5-err\.png\]/);
    assert.match(prompt, /Open them with your file tools/);
  });

  it('says so when a file could not be loaded, without pretending it is there', () => {
    const prompt = buildPrompt(history, new Set());

    assert.match(prompt, /\[attached image "err\.png" could not be loaded\]/);
    assert.doesNotMatch(prompt, /Open them with your file tools/);
  });

  it('is unchanged for a conversation with no files', () => {
    const prompt = buildPrompt([{ role: 'user', content: 'hi' }]);

    assert.doesNotMatch(prompt, /attach/i);
    assert.match(prompt, /^User: hi\n\nContinue the conversation/);
  });
});
