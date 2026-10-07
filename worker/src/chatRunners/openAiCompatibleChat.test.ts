import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import { openAiCompatibleChat } from './openAiCompatibleChat.js';

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

    it('sends no tools and no system prompt when there is no toolset', async () => {
      const { bodies } = sequence([{ role: 'assistant', content: 'hi' }]);

      await openAiCompatibleChat(history, options);

      assert.equal(bodies[0].tools, undefined);
      assert.equal(bodies[0].messages[0].role, 'user');
    });
  });
});
