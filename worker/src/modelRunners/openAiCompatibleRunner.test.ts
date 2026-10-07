import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { executeTool, MAX_TOOL_RESULT_CHARS } from './openAiCompatibleRunner.js';

describe('executeTool read_file', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'read-file-test-'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns a file at the cap unchanged', () => {
    const content = 'a'.repeat(MAX_TOOL_RESULT_CHARS);
    writeFileSync(join(dir, 'small.txt'), content);
    assert.equal(executeTool(dir, 'read_file', { path: 'small.txt' }), content);
  });

  it('truncates a larger file with a notice including the total size', () => {
    const total = MAX_TOOL_RESULT_CHARS + 123;
    writeFileSync(join(dir, 'big.txt'), 'b'.repeat(total));
    const result = executeTool(dir, 'read_file', { path: 'big.txt' });
    assert.ok(result.startsWith('b'.repeat(MAX_TOOL_RESULT_CHARS)));
    assert.ok(result.includes(`[truncated: file has ${total} chars; ${MAX_TOOL_RESULT_CHARS} shown`));
    assert.ok(result.length < total);
  });

  it('reads the remainder with offset', () => {
    const total = MAX_TOOL_RESULT_CHARS + 10;
    writeFileSync(join(dir, 'big2.txt'), 'c'.repeat(total));
    const result = executeTool(dir, 'read_file', { path: 'big2.txt', offset: MAX_TOOL_RESULT_CHARS });
    assert.equal(result, 'c'.repeat(10));
  });
});
