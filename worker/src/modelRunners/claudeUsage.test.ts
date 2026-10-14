import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ClaudeStreamParser, parseLimits, parseUsage } from './claudeUsage.js';

const line = (event: unknown) => `${JSON.stringify(event)}\n`;

const LIMIT_EVENT = {
  type: 'rate_limit_event',
  rate_limit_info: {
    status: 'allowed_warning',
    resetsAt: 1792148400,
    rateLimitType: 'seven_day',
    utilization: 0.76,
    isUsingOverage: false,
    unifiedWindows: {
      five_hour: { utilization: 0.16, resetsAt: 1792000800 },
      seven_day: { utilization: 0.76, resetsAt: 1792148400 },
    },
  },
};

describe('parseLimits', () => {
  it('reads every window the CLI reports', () => {
    assert.deepEqual(parseLimits(LIMIT_EVENT.rate_limit_info), {
      status: 'allowed_warning',
      rateLimitType: 'seven_day',
      isUsingOverage: false,
      windows: {
        five_hour: { utilization: 0.16, resetsAt: 1792000800 },
        seven_day: { utilization: 0.76, resetsAt: 1792148400 },
      },
    });
  });

  it('falls back to the one window an event names itself', () => {
    const limits = parseLimits({ status: 'allowed', rateLimitType: 'five_hour', utilization: 0.5, resetsAt: 10 });

    assert.deepEqual(limits?.windows, { five_hour: { utilization: 0.5, resetsAt: 10 } });
  });

  it('ignores garbage', () => {
    assert.equal(parseLimits(null), undefined);
    assert.equal(parseLimits({ nope: 1 }), undefined);
    assert.deepEqual(parseLimits({ status: 'allowed', unifiedWindows: { five_hour: 'x' } })?.windows, {});
  });
});

describe('parseUsage', () => {
  it('reads tokens and cost', () => {
    assert.deepEqual(
      parseUsage({ total_cost_usd: 0.25, usage: { input_tokens: 2, output_tokens: 4, cache_read_input_tokens: 10, cache_creation_input_tokens: 7 } }),
      { costUsd: 0.25, inputTokens: 2, outputTokens: 4, cacheReadTokens: 10, cacheCreationTokens: 7 },
    );
  });

  it('is undefined without usage, and tolerates a missing cost', () => {
    assert.equal(parseUsage({}), undefined);
    assert.equal(parseUsage({ usage: { input_tokens: 1 } })?.costUsd, null);
  });
});

describe('ClaudeStreamParser', () => {
  it('turns assistant text into log text and keeps the limits, usage and final reply', () => {
    const texts: string[] = [];
    const parser = new ClaudeStreamParser((text) => texts.push(text));

    parser.push(line({ type: 'system', subtype: 'init' }));
    parser.push(line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Working on it' }, { type: 'tool_use', name: 'Bash' }] } }));
    parser.push(line(LIMIT_EVENT));
    parser.push(line({ type: 'result', result: 'All done', total_cost_usd: 0.1, usage: { input_tokens: 1, output_tokens: 2 } }));
    parser.end();

    assert.deepEqual(texts, ['Working on it\n']);
    assert.equal(parser.finalText, 'All done');
    assert.equal(parser.report.limits?.status, 'allowed_warning');
    assert.equal(parser.report.usage?.costUsd, 0.1);
  });

  it('handles a line split across chunks and a last line with no newline', () => {
    const texts: string[] = [];
    const parser = new ClaudeStreamParser((text) => texts.push(text));
    const whole = line({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } });

    parser.push(whole.slice(0, 20));
    parser.push(whole.slice(20, -1));
    parser.end();

    assert.deepEqual(texts, ['hi\n']);
  });

  it('passes a line that is not JSON through unchanged', () => {
    const texts: string[] = [];
    const parser = new ClaudeStreamParser((text) => texts.push(text));

    parser.push('Error: something broke\n');
    parser.push('{"just":"an object"}\n');

    assert.deepEqual(texts, ['Error: something broke\n', '{"just":"an object"}\n']);
    assert.deepEqual(parser.report, {});
  });
});
