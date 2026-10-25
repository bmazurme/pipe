import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ClaudeStreamParser, MAX_PENDING_LINE_CHARS, parseLimits, parseUsage, type StreamDelta } from './claudeUsage.js';

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

  it('reports the reply as it is written, from partial-message events, without touching the log text', () => {
    const texts: string[] = [];
    const deltas: unknown[] = [];
    const parser = new ClaudeStreamParser((text) => texts.push(text), (delta) => deltas.push(delta));
    const delta = (inner: object) => line({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: inner } });

    parser.push(line({ type: 'stream_event', event: { type: 'message_start' } }));
    parser.push(delta({ type: 'thinking_delta', thinking: 'hmm' }));
    parser.push(delta({ type: 'text_delta', text: 'Hel' }));
    parser.push(delta({ type: 'text_delta', text: 'lo' }));
    parser.push(delta({ type: 'input_json_delta', partial_json: '{' }));

    assert.deepEqual(deltas, [
      { kind: 'thinking', text: 'hmm' },
      { kind: 'text', text: 'Hel' },
      { kind: 'text', text: 'lo' },
    ]);
    assert.deepEqual(texts, []);
  });

  it('ignores partial-message events when nobody listens', () => {
    const parser = new ClaudeStreamParser(() => undefined);

    assert.doesNotThrow(() => parser.push(line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } } })));
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

describe('ClaudeStreamParser chunking', () => {
  const delta = (text: string) => line({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } });

  const run = (chunks: string[]) => {
    const texts: string[] = [];
    const deltas: StreamDelta[] = [];
    const parser = new ClaudeStreamParser((text) => texts.push(text), (d) => deltas.push(d));

    for (const chunk of chunks) parser.push(chunk);
    parser.end();

    return { texts, deltas, report: parser.report, finalText: parser.finalText };
  };

  // A small seeded generator, so a failing split can be reproduced.
  const random = (seed: number) => () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;

    return seed / 2147483648;
  };

  const stream = [
    line({ type: 'system', subtype: 'init' }),
    delta('Hel'),
    delta('lo, wörld 🌍'),
    'plain text error\n',
    '\n',
    line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Working on it' }] } }),
    line(LIMIT_EVENT),
    line({ type: 'result', result: 'All done', total_cost_usd: 0.1, usage: { input_tokens: 1, output_tokens: 2 } }),
    'trailing line with no newline',
  ].join('');

  it('gives the same result fed in one piece, byte by byte and in random-size chunks', () => {
    const whole = run([stream]);

    assert.deepEqual(whole.texts, ['plain text error\n', 'Working on it\n', 'trailing line with no newline\n']);
    assert.equal(whole.deltas.length, 2);
    assert.equal(whole.finalText, 'All done');

    assert.deepEqual(run([...stream]), whole);

    for (let seed = 1; seed <= 20; seed++) {
      const next = random(seed);
      const chunks: string[] = [];

      for (let at = 0; at < stream.length; ) {
        const size = 1 + Math.floor(next() * 40);

        chunks.push(stream.slice(at, at + size));
        at += size;
      }

      assert.deepEqual(run(chunks), whole, `seed ${seed}`);
    }
  });

  it('parses a 5 MB line delivered in 64 KB chunks as one event', () => {
    const big = 'x'.repeat(5 * 1024 * 1024);
    const whole = line({ type: 'assistant', message: { content: [{ type: 'text', text: big }] } });
    const chunks: string[] = [];

    for (let at = 0; at < whole.length; at += 64 * 1024) chunks.push(whole.slice(at, at + 64 * 1024));

    const { texts } = run(chunks);

    assert.equal(texts.length, 1);
    assert.equal(texts[0], `${big}\n`);
  });

  it('passes a line past the cap on once as raw text and does not keep growing it', () => {
    const texts: string[] = [];
    const parser = new ClaudeStreamParser((text) => texts.push(text));
    const runaway = 'y'.repeat(MAX_PENDING_LINE_CHARS + 1);

    parser.push(runaway);
    assert.deepEqual(texts, [`${runaway}\n`]);

    // The rest of that line starts from an empty buffer; the next line parses as usual.
    parser.push('tail\n');
    parser.push(line({ type: 'result', result: 'ok' }));
    parser.end();

    assert.equal(texts.length, 2);
    assert.equal(texts[1], 'tail\n');
    assert.equal(parser.finalText, 'ok');
  });

  it('parses in linear time: 10,000 short lines in one chunk, and a 5 MB line in 64 KB chunks', () => {
    const many = Array.from({ length: 10_000 }, (_, i) => delta(`d${i}`)).join('');
    let started = performance.now();
    const { deltas } = run([many]);

    assert.equal(deltas.length, 10_000);
    assert.ok(performance.now() - started < 1000, `10,000 lines took ${performance.now() - started} ms`);

    const whole = line({ type: 'assistant', message: { content: [{ type: 'text', text: 'z'.repeat(5 * 1024 * 1024) }] } });
    const chunks: string[] = [];

    for (let at = 0; at < whole.length; at += 64 * 1024) chunks.push(whole.slice(at, at + 64 * 1024));

    started = performance.now();
    const { texts } = run(chunks);

    assert.equal(texts.length, 1);
    assert.ok(performance.now() - started < 1000, `the 5 MB line took ${performance.now() - started} ms`);
  });
});
