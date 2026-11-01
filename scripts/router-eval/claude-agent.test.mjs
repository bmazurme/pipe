import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { agentArgs, ALLOWED_TOOLS, parseAgentResult } from './claude-agent.mjs';

describe('agentArgs', () => {
  it('asks for one JSON result, accepts edits, and names the tools allowed — no install, no deletion, no network', () => {
    const args = agentArgs({ prompt: 'do it', model: 'haiku' });

    assert.deepEqual(args.slice(0, 4), ['-p', 'do it', '--model', 'haiku']);
    assert.ok(args.includes('json') && args.includes('acceptEdits'));
    assert.deepEqual(args.slice(args.indexOf('--allowedTools') + 1), ALLOWED_TOOLS);

    for (const forbidden of ['npm install', 'npm ci', 'rm', 'curl', 'git push', 'git checkout']) {
      assert.ok(!ALLOWED_TOOLS.some((tool) => tool.startsWith(`Bash(${forbidden}`)), forbidden);
    }
    assert.ok(!ALLOWED_TOOLS.includes('Bash'), 'no blanket shell');
  });
});

describe('parseAgentResult', () => {
  const output = JSON.stringify({
    type: 'result',
    is_error: false,
    result: 'Done.',
    total_cost_usd: 0.0421,
    num_turns: 7,
    usage: { input_tokens: 100, cache_read_input_tokens: 5000, cache_creation_input_tokens: 400, output_tokens: 300 },
  });

  it('reads the answer, the cost, the turns and the tokens (cached input included)', () => {
    assert.deepEqual(parseAgentResult(output), { text: 'Done.', isError: false, costUsd: 0.0421, turns: 7, inputTokens: 5500, outputTokens: 300 });
  });

  it('takes the last line, tolerates missing fields, and refuses what is not JSON', () => {
    assert.equal(parseAgentResult(`warning\n${output}\n`)?.turns, 7);
    assert.deepEqual(parseAgentResult('{"result":"x","is_error":true}'), { text: 'x', isError: true, costUsd: null, turns: 0, inputTokens: 0, outputTokens: 0 });

    for (const text of ['', 'not json', '[1]', 'null', '{}', '{"type":"other"}']) assert.equal(parseAgentResult(text), null, text);
  });
});
