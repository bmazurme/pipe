import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';

import { reviewIssueBeforeDispatch } from './reviewPrompt.js';

// input/output are injected (see ReviewIO) specifically so tests don't need
// a real TTY or to stub process.stdin globally.
function testIO() {
  const input = new PassThrough();
  const output = new PassThrough();
  output.on('data', () => {}); // drain so writes never block
  return { input, output };
}

// readline resolves question() by racing the *next* 'line' event after it's
// called — it does not queue up lines written before the next question() is
// even requested. Writing all answers in one synchronous burst means every
// line but the first gets silently processed with nobody listening yet, so
// each write here waits a tick for the prior answer's `await` to resume and
// register the next question() first.
async function answer(input: PassThrough, ...lines: string[]) {
  for (const line of lines) {
    input.write(`${line}\n`);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const originalEditor = process.env.EDITOR;
const originalVisual = process.env.VISUAL;

beforeEach(() => {
  delete process.env.EDITOR;
  delete process.env.VISUAL;
});

afterEach(() => {
  if (originalEditor === undefined) delete process.env.EDITOR;
  else process.env.EDITOR = originalEditor;
  if (originalVisual === undefined) delete process.env.VISUAL;
  else process.env.VISUAL = originalVisual;
});

describe('reviewIssueBeforeDispatch', () => {
  it('defaults to no edit, no model override, and proceeding on blank answers', async () => {
    const io = testIO();
    const promise = reviewIssueBeforeDispatch({ title: 'Fix bug', description: 'Details', imagePaths: [] }, io);

    await answer(io.input, '', '', '');
    const result = await promise;

    assert.deepEqual(result, { title: 'Fix bug', description: 'Details', model: undefined, proceed: true });
  });

  it('passes through a chosen model', async () => {
    const io = testIO();
    const promise = reviewIssueBeforeDispatch({ title: 'Fix bug', description: 'Details', imagePaths: [] }, io);

    await answer(io.input, 'n', 'opus', 'y');
    const result = await promise;

    assert.equal(result.model, 'opus');
    assert.equal(result.proceed, true);
  });

  it('reports proceed: false when the user declines', async () => {
    const io = testIO();
    const promise = reviewIssueBeforeDispatch({ title: 'Fix bug', description: 'Details', imagePaths: [] }, io);

    await answer(io.input, 'n', '', 'n');
    const result = await promise;

    assert.equal(result.proceed, false);
  });

  it('opens $EDITOR on the text and re-reads the edited title/description', async () => {
    // A trivial "editor" that overwrites the file it's given — stands in for
    // a real editor without needing one installed in CI.
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const scriptDir = mkdtempSync(path.join(tmpdir(), 'sync-cli-review-editor-'));
    const scriptPath = path.join(scriptDir, 'editor.js');
    writeFileSync(
      scriptPath,
      // process.argv[0] is node, [1] is this script's own path, [2] is the
      // file spawnSync passed as the actual "open this file" argument.
      "require('node:fs').writeFileSync(process.argv[2], 'New title\\n\\nNew description line one\\nline two\\n');",
    );
    process.env.EDITOR = `${process.execPath} ${scriptPath}`;

    const io = testIO();
    const promise = reviewIssueBeforeDispatch({ title: 'Old title', description: 'Old description', imagePaths: [] }, io);

    await answer(io.input, 'y', '', 'y');
    const result = await promise;

    assert.equal(result.title, 'New title');
    assert.equal(result.description, 'New description line one\nline two');
  });
});
