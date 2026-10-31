import { CHAT_ACTIONS_INSTRUCTION } from './chatActions.js';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import { openAiCompatibleChat, readCompletionStream } from './openAiCompatibleChat.js';

const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

describe('openAiCompatibleChat', () => {
  it('sends the full history with no tools and returns the reply text', async () => {
    let capturedUrl: string | undefined;
    let capturedBody: unknown;

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'sure, here you go' } }] }),
        { status: 200 },
      );
    }) as typeof fetch;

    const reply = await openAiCompatibleChat(
      [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }, { role: 'user', content: 'again' }],
      { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'ds-x', model: 'deepseek-chat' },
    );

    assert.equal(capturedUrl, 'https://api.deepseek.com/v1/chat/completions');
    assert.deepEqual(capturedBody, {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: CHAT_ACTIONS_INSTRUCTION },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'again' },
      ],
    });
    assert.ok(!('tools' in (capturedBody as object)));
    assert.equal(reply, 'sure, here you go');
  });

  it('passes a dispatcher only when a proxy URL is given', async () => {
    let capturedInit: RequestInit | undefined;

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    }) as typeof fetch;

    await openAiCompatibleChat(
      [{ role: 'user', content: 'hi' }],
      { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'x', model: 'deepseek-chat' },
    );
    assert.equal((capturedInit as { dispatcher?: unknown })?.dispatcher, undefined);

    await openAiCompatibleChat(
      [{ role: 'user', content: 'hi' }],
      { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'x', model: 'deepseek-chat' },
      'http://vpn-client:1080',
    );
    assert.ok((capturedInit as { dispatcher?: unknown })?.dispatcher);
  });

  it('uses the key\'s auth scheme, extra headers and route', async () => {
    let capturedInit: (RequestInit & { dispatcher?: unknown }) | undefined;

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      capturedInit = init as never;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    }) as typeof fetch;

    await openAiCompatibleChat(
      [{ role: 'user', content: 'hi' }],
      { baseUrl: 'http://ollama.lan:11434/v1', apiKey: '', model: 'm', authScheme: 'none', extraHeaders: { 'x-a': '1' } },
      'http://vpn-client:1080',
    );

    const headers = capturedInit?.headers as Record<string, string>;

    assert.ok(!('Authorization' in headers));
    assert.equal(headers['x-a'], '1');
    // a private address does not go through the proxy
    assert.equal(capturedInit?.dispatcher, undefined);

    await assert.rejects(
      openAiCompatibleChat([{ role: 'user', content: 'hi' }], { baseUrl: 'https://x.example/v1', apiKey: 'k', model: 'm', route: 'vpn' }),
      /requires the VPN/,
    );
  });

  it('throws a descriptive error on a failure status', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 500 })) as typeof fetch;

    await assert.rejects(
      openAiCompatibleChat([{ role: 'user', content: 'hi' }], {
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'x',
        model: 'deepseek-chat',
      }),
      /deepseek-chat API error \(500\)/,
    );
  });

  describe('malformed or empty replies', () => {
    const emptyOptions = { baseUrl: 'http://provider.test', apiKey: 'key', model: 'test-model' };
    const history = [{ role: 'user' as const, content: 'hi' }];
    const stubFetch = (body: unknown): void => {
      globalThis.fetch = (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
    };

    it('returns a normal reply unchanged', async () => {
      stubFetch({ choices: [{ message: { content: 'hello there' } }] });
      assert.equal(await openAiCompatibleChat(history, emptyOptions), 'hello there');
    });

    for (const [name, body] of [
      ['choices is empty', { choices: [] }],
      ['choices is missing', {}],
      ['message is missing', { choices: [{}] }],
      ['content is null', { choices: [{ message: { content: null } }] }],
      ['content is whitespace only', { choices: [{ message: { content: '  \n ' } }] }],
    ] as const) {
      it(`rejects when ${name}`, async () => {
        stubFetch(body);
        await assert.rejects(openAiCompatibleChat(history, emptyOptions), /test-model returned an empty reply/);
      });
    }
  });

  describe('with a toolset', () => {
    const options = { baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'gpt-test' };
    const history = [{ role: 'user' as const, content: 'what is job 3 doing?' }];

    function sequence(responses: unknown[]): { bodies: Array<{ messages: Array<Record<string, unknown>>; tools?: unknown }> } {
      const bodies: Array<{ messages: Array<Record<string, unknown>>; tools?: unknown }> = [];
      let i = 0;

      globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(init?.body as string));

        return new Response(JSON.stringify({ choices: [{ message: responses[Math.min(i++, responses.length - 1)] }] }), { status: 200 });
      }) as typeof fetch;

      return { bodies };
    }

    const toolCall = (name: string, args: object) => ({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call-1', type: 'function', function: { name, arguments: JSON.stringify(args) } }],
    });

    it('runs the tool the model asks for and feeds the result back before the final answer', async () => {
      const { bodies } = sequence([toolCall('get_job', { id: 3 }), { role: 'assistant', content: 'Job 3 is running.' }]);
      const executed: Array<[string, Record<string, unknown>]> = [];
      const toolset = {
        definitions: [{ type: 'function' as const, function: { name: 'get_job', description: 'd', parameters: {} } }],
        execute: async (name: string, args: Record<string, unknown>) => {
          executed.push([name, args]);
          return '{"id":3,"status":"running"}';
        },
      };

      const reply = await openAiCompatibleChat(history, options, undefined, toolset);

      assert.equal(reply, 'Job 3 is running.');
      assert.deepEqual(executed, [['get_job', { id: 3 }]]);
      assert.equal(bodies.length, 2);
      assert.equal(bodies[0].messages[0].role, 'system');
      assert.ok(bodies[0].tools);
      const last = bodies[1].messages[bodies[1].messages.length - 1];
      assert.deepEqual(last, { role: 'tool', tool_call_id: 'call-1', content: '{"id":3,"status":"running"}' });
    });

    it('withholds the tools after the allowed rounds so a looping model must answer', async () => {
      const { bodies } = sequence([toolCall('get_job', { id: 1 })]);
      const toolset = {
        definitions: [{ type: 'function' as const, function: { name: 'get_job', description: 'd', parameters: {} } }],
        execute: async () => 'ok',
      };

      // The stub always asks for another tool call; after MAX rounds the request carries no tools and
      // the (still tool-calling) reply has no content, which is reported rather than looped on.
      await assert.rejects(openAiCompatibleChat(history, options, undefined, toolset), /returned an empty reply/);
      assert.ok(bodies.length >= 2);
      assert.equal(bodies[bodies.length - 1].tools, undefined);
    });

    it('tolerates malformed tool arguments by passing an empty object', async () => {
      sequence([
        { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'list_jobs', arguments: '{oops' } }] },
        { role: 'assistant', content: 'done' },
      ]);
      let seen: Record<string, unknown> | undefined;
      const toolset = {
        definitions: [],
        execute: async (_name: string, args: Record<string, unknown>) => {
          seen = args;
          return '[]';
        },
      };

      assert.equal(await openAiCompatibleChat(history, options, undefined, toolset), 'done');
      assert.deepEqual(seen, {});
    });

    it('sends no tools and only the actions instruction as system prompt when there is no toolset', async () => {
      const { bodies } = sequence([{ role: 'assistant', content: 'hi' }]);

      await openAiCompatibleChat(history, options);

      assert.equal(bodies[0].tools, undefined);
      assert.deepEqual(bodies[0].messages[0], { role: 'system', content: CHAT_ACTIONS_INSTRUCTION });
      assert.equal(bodies[0].messages[1].role, 'user');
    });
  });
});

const sse = (...events: string[]) =>
  new Response(events.map((event) => `data: ${event}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });

const chunk = (content: string) => JSON.stringify({ choices: [{ delta: { content } }] });

describe('readCompletionStream', () => {
  const streamOf = (...parts: string[]) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
        controller.close();
      },
    });

  it('reports answer and reasoning text as it arrives, across lines split between network chunks', async () => {
    const seen: [string, string][] = [];
    const whole = `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'hm' } }] })}\n\ndata: ${chunk('Hel')}\n\ndata: ${chunk('lo')}\n\ndata: [DONE]\n\n`;

    await readCompletionStream(streamOf(whole.slice(0, 40), whole.slice(40, 95), whole.slice(95)), (delta) => seen.push([delta.kind, delta.text]));

    assert.deepEqual(seen, [
      ['thinking', 'hm'],
      ['text', 'Hel'],
      ['text', 'lo'],
    ]);
  });

  it('skips comments, blank lines, non-JSON and empty deltas, and reads a last line with no newline', async () => {
    const seen: string[] = [];

    await readCompletionStream(
      streamOf(': keep-alive\n\ndata: not json\n\ndata: {"choices":[{"delta":{}}]}\n\ndata: {"choices":[]}\n\n', `data: ${chunk('tail')}`),
      (delta) => seen.push(delta.text),
    );

    assert.deepEqual(seen, ['tail']);
  });
});

describe('openAiCompatibleChat streaming', () => {
  const options = { baseUrl: 'http://ollama.lan:11434/v1', apiKey: '', model: 'm', authScheme: 'none', stream: true } as const;
  const history = [{ role: 'user' as const, content: 'hi' }];

  it('streams a key that asks for it: sends stream:true, reports the text so far, returns the whole answer', async () => {
    let body: Record<string, unknown> = {};
    const progress: string[] = [];

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      body = JSON.parse(init?.body as string);

      // the chunks arrive over time, like a model writing: the first words are reported at once
      const parts = [chunk('Hel'), chunk('lo'), '[DONE]'];
      let next = 0;

      return new Response(
        new ReadableStream<Uint8Array>({
          async pull(controller) {
            if (next >= parts.length) return controller.close();
            await new Promise((resolve) => setTimeout(resolve, 10));
            controller.enqueue(new TextEncoder().encode(`data: ${parts[next++]}\n\n`));
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    }) as typeof fetch;

    const reply = await openAiCompatibleChat(history, options, undefined, null, null, (text) => void progress.push(text));

    assert.equal(reply, 'Hello');
    assert.equal(body.stream, true);
    assert.ok(progress.length > 0 && progress.every((text) => 'Hello'.startsWith(text)), progress.join('|'));
  });

  it('does not stream without a progress listener, or for a key that did not ask', async () => {
    const bodies: Record<string, unknown>[] = [];

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(init?.body as string));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'plain' } }] }), { status: 200 });
    }) as typeof fetch;

    assert.equal(await openAiCompatibleChat(history, options), 'plain');
    assert.equal(await openAiCompatibleChat(history, { ...options, stream: undefined }, undefined, null, null, () => {}), 'plain');
    assert.ok(bodies.every((body) => !('stream' in body)));
  });

  it('takes a plain JSON answer from a server that ignores stream', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'plain' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

    assert.equal(await openAiCompatibleChat(history, options, undefined, null, null, () => {}), 'plain');
  });

  it('fails on a stream that carried no text, and on an error status', async () => {
    globalThis.fetch = (async () => sse('[DONE]')) as typeof fetch;
    await assert.rejects(openAiCompatibleChat(history, options, undefined, null, null, () => {}), /empty reply/);

    globalThis.fetch = (async () => new Response('down', { status: 503 })) as typeof fetch;
    await assert.rejects(openAiCompatibleChat(history, options, undefined, null, null, () => {}), /API error \(503\)/);
  });
});
