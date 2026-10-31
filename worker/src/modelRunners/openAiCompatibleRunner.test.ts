import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";

import { CancelledError } from "../cancelled.js";
import {
  executeTool,
  MAX_TOOL_RESULT_CHARS,
  parseTextToolCall,
  runOpenAiCompatible,
} from "./openAiCompatibleRunner.js";

describe("executeTool read_file", () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "read-file-test-"));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns a file at the cap unchanged", () => {
    const content = "a".repeat(MAX_TOOL_RESULT_CHARS);
    writeFileSync(join(dir, "small.txt"), content);
    assert.equal(executeTool(dir, "read_file", { path: "small.txt" }), content);
  });

  it("truncates a larger file with a notice including the total size", () => {
    const total = MAX_TOOL_RESULT_CHARS + 123;
    writeFileSync(join(dir, "big.txt"), "b".repeat(total));
    const result = executeTool(dir, "read_file", { path: "big.txt" });
    assert.ok(result.startsWith("b".repeat(MAX_TOOL_RESULT_CHARS)));
    assert.ok(
      result.includes(
        `[truncated: file has ${total} chars; ${MAX_TOOL_RESULT_CHARS} shown`,
      ),
    );
    assert.ok(result.length < total);
  });

  it("reads the remainder with offset", () => {
    const total = MAX_TOOL_RESULT_CHARS + 10;
    writeFileSync(join(dir, "big2.txt"), "c".repeat(total));
    const result = executeTool(dir, "read_file", {
      path: "big2.txt",
      offset: MAX_TOOL_RESULT_CHARS,
    });
    assert.equal(result, "c".repeat(10));
  });
});

describe("executeTool write_file", () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "write-file-test-"));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses a path inside .git with the shared helper message", () => {
    assert.throws(
      () =>
        executeTool(dir, "write_file", { path: ".git/config", content: "x" }),
      /Path inside \.git is not allowed: \.git\/config/,
    );
  });
});

const deadlineOptions = {
  baseUrl: "http://stub.invalid",
  apiKey: "k",
  model: "gpt-test",
};

describe("runOpenAiCompatible job deadline", () => {
  const realFetch = globalThis.fetch;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "oai-runner-"));
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects while a request is in flight", async () => {
    globalThis.fetch = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason),
        );
      })) as typeof fetch;

    // AbortSignal.timeout's timer is unref'd, so with nothing else scheduled the
    // event loop would drain while the mocked fetch is pending (Node 22 reports
    // that as a cancelled test) — hold it open until the deadline fires.
    const keepAlive = setTimeout(() => {}, 5000);
    try {
      await assert.rejects(
        runOpenAiCompatible(
          dir,
          "task",
          deadlineOptions,
          () => {},
          undefined,
          50,
        ),
        /gpt-test job timed out after 0\.05s/,
      );
    } finally {
      clearTimeout(keepAlive);
    }
  });

  it("rejects on the next turn once the deadline has passed", async () => {
    let calls = 0;
    // Like a real fetch: yields to the event loop (so the deadline timer can fire)
    // and rejects with the abort reason when its signal is already aborted.
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (init?.signal?.aborted) throw init.signal.reason;

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "c1",
                    function: { name: "list_files", arguments: "{}" },
                  },
                ],
              },
            },
          ],
        }),
      );
    }) as typeof fetch;

    // Burns past the deadline synchronously while the first turn's tool output is logged.
    const onOutput = () => {
      const end = Date.now() + 80;
      while (Date.now() < end) {
        /* spin */
      }
    };

    await assert.rejects(
      runOpenAiCompatible(
        dir,
        "task",
        deadlineOptions,
        onOutput,
        undefined,
        40,
      ),
      /gpt-test job timed out/,
    );
    assert.equal(calls, 2);
  });

  it("keeps running without a timeout", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "done" } }],
        }),
      )) as typeof fetch;

    const result = await runOpenAiCompatible(
      dir,
      "task",
      deadlineOptions,
      () => {},
    );
    assert.equal(result.exitCode, 0);
  });
});

describe("runOpenAiCompatible stop requests", () => {
  const realFetch = globalThis.fetch;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "oai-runner-stop-"));
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    rmSync(dir, { recursive: true, force: true });
  });

  const pendingUntilAborted = (() =>
    new Promise((_resolve, reject) => {
      // never answers; only an abort ends it
      setTimeout(() => reject(new Error("test would hang")), 10_000).unref();
    })) as unknown as typeof fetch;

  it("stops a request that is in flight when the owner asks", async () => {
    globalThis.fetch = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason),
        );
      })) as typeof fetch;
    const stop = new AbortController();
    const keepAlive = setTimeout(() => {}, 5000); // AbortSignal.timeout timers are unref'd
    setTimeout(() => stop.abort(), 50);

    try {
      await assert.rejects(
        runOpenAiCompatible(
          dir,
          "task",
          deadlineOptions,
          () => {},
          undefined,
          undefined,
          stop.signal,
        ),
        CancelledError,
      );
    } finally {
      clearTimeout(keepAlive);
    }
  });

  it("does not call the model at all when already stopped, and a stop wins over the deadline", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return pendingUntilAborted;
    }) as unknown as typeof fetch;
    const stop = new AbortController();
    stop.abort();

    await assert.rejects(
      runOpenAiCompatible(
        dir,
        "task",
        deadlineOptions,
        () => {},
        undefined,
        1,
        stop.signal,
      ),
      CancelledError,
    );
    assert.equal(calls, 0);
  });
});

describe("runOpenAiCompatible turn retry", () => {
  const realFetch = globalThis.fetch;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "oai-runner-retry-"));
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    rmSync(dir, { recursive: true, force: true });
  });

  const answer = () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: "done" } }],
      }),
      { status: 200 },
    );

  it("retries once after a network error and completes", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      if (calls++ === 0) throw new TypeError("fetch failed");
      return answer();
    }) as typeof fetch;

    const logged: string[] = [];
    const result = await runOpenAiCompatible(
      dir,
      "go",
      deadlineOptions,
      (c) => logged.push(c),
      undefined,
      undefined,
      undefined,
      0,
    );

    assert.equal(result.exitCode, 0);
    assert.equal(calls, 2);
    assert.ok(
      logged.some((l) =>
        l.includes("retrying gpt-test turn after: fetch failed"),
      ),
    );
  });

  it("does not retry a 401", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("bad key", { status: 401 });
    }) as typeof fetch;

    await assert.rejects(
      runOpenAiCompatible(
        dir,
        "go",
        deadlineOptions,
        () => {},
        undefined,
        undefined,
        undefined,
        0,
      ),
      /401/,
    );
    assert.equal(calls, 1);
  });

  it("ends as CancelledError when stopped during the retry wait", async () => {
    const controller = new AbortController();
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;

    const run = runOpenAiCompatible(
      dir,
      "go",
      deadlineOptions,
      (c) => {
        if (c.startsWith("retrying")) controller.abort();
      },
      undefined,
      undefined,
      controller.signal,
      10_000,
    );

    await assert.rejects(run, CancelledError);
  });
});

describe("runOpenAiCompatible request shape", () => {
  const realFetch = globalThis.fetch;
  let dir: string;
  let captured: { url: string; init: RequestInit & { dispatcher?: unknown } } | undefined;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "oai-runner-"));
    captured = undefined;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      captured = { url, init: init as never };
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "done" } }] }));
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    rmSync(dir, { recursive: true, force: true });
  });

  const run = (options: Parameters<typeof runOpenAiCompatible>[2], proxyUrl?: string) =>
    runOpenAiCompatible(dir, "task", options, () => {}, proxyUrl, 5000);

  it("sends the key's scheme and extra headers", async () => {
    await run({
      baseUrl: "http://192.168.50.35:11434/v1",
      apiKey: "k",
      model: "m",
      authScheme: "api-key",
      extraHeaders: { "x-folder-id": "b1g" },
    });

    const headers = captured?.init.headers as Record<string, string>;

    assert.equal(headers.Authorization, "Api-Key k");
    assert.equal(headers["x-folder-id"], "b1g");
  });

  it("goes around the proxy to a private address, through it to a public one", async () => {
    await run({ baseUrl: "http://192.168.50.35:11434/v1", apiKey: "k", model: "m" }, "http://127.0.0.1:18080");
    assert.equal(captured?.init.dispatcher, undefined);

    await run({ baseUrl: "https://api.openai.com/v1", apiKey: "k", model: "m" }, "http://127.0.0.1:18080");
    assert.ok(captured?.init.dispatcher);
  });

  it("a key set to direct ignores the proxy; one set to vpn refuses to run without it", async () => {
    await run({ baseUrl: "https://api.openai.com/v1", apiKey: "k", model: "m", route: "direct" }, "http://127.0.0.1:18080");
    assert.equal(captured?.init.dispatcher, undefined);

    captured = undefined;
    await assert.rejects(run({ baseUrl: "https://api.openai.com/v1", apiKey: "k", model: "m", route: "vpn" }), /requires the VPN/);
    assert.equal(captured, undefined);
  });
});

describe("parseTextToolCall", () => {
  const call = { name: "list_files", arguments: "{}" };

  it("reads a call printed as bare JSON, in a ``` fence, or in <tool_call> tags", () => {
    expectCall('{"name": "list_files", "arguments": {}}');
    expectCall('```json\n{"name": "list_files", "arguments": {}}\n```');
    expectCall('```\n{"name":"list_files"}\n```');
    expectCall('<tool_call>\n{"name": "list_files", "arguments": {}}\n</tool_call>');

    function expectCall(text: string) {
      assert.deepEqual(parseTextToolCall(text), call, text);
    }
  });

  it("keeps the arguments", () => {
    assert.deepEqual(parseTextToolCall('{"name": "write_file", "arguments": {"path": "a.js", "content": "x"}}'), {
      name: "write_file",
      arguments: '{"path":"a.js","content":"x"}',
    });
  });

  it("never treats prose, another tool, or malformed JSON as a call", () => {
    for (const text of [
      "",
      "I will call list_files now",
      'Sure: {"name": "list_files", "arguments": {}}',
      '{"name": "run_command", "arguments": {"cmd": "rm -rf /"}}',
      '{"name": "list_files", "arguments": "oops"}',
      '{"name": "list_files", "arguments": [1]}',
      '{"name": "list_files"',
      "[1, 2]",
      "null",
    ]) {
      assert.equal(parseTextToolCall(text), null, text);
    }
    assert.equal(parseTextToolCall(null), null);
  });
});

describe("runOpenAiCompatible with a call printed as text", () => {
  const realFetch = globalThis.fetch;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "oai-runner-"));
    writeFileSync(join(dir, "test.js"), "// test.js\n");
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    rmSync(dir, { recursive: true, force: true });
  });

  function replies(...contents: (string | { tool_calls: unknown[] })[]) {
    const sent: { messages: { role: string; tool_calls?: unknown[]; content?: string | null }[] }[] = [];
    let i = 0;

    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      const next = contents[Math.min(i++, contents.length - 1)];

      return new Response(
        JSON.stringify({ choices: [{ message: typeof next === "string" ? { role: "assistant", content: next } : { role: "assistant", content: null, ...next } }] }),
      );
    }) as typeof fetch;

    return sent;
  }

  const run = (output: string[]) =>
    runOpenAiCompatible(dir, "task", { baseUrl: "http://stub.invalid", apiKey: "k", model: "m" }, (chunk) => output.push(chunk), undefined, 5000);

  it("runs the call, goes on, and finishes when the model answers in words", async () => {
    const sent = replies(
      '```json\n{"name": "write_file", "arguments": {"path": "test.js", "content": "console.log(1);\\n"}}\n```',
      "Done.",
    );
    const output: string[] = [];
    const result = await run(output);

    assert.equal(result.exitCode, 0);
    assert.equal(readFileSync(join(dir, "test.js"), "utf-8"), "console.log(1);\n");
    assert.match(output.join(""), /printed a call to write_file as text/);
    assert.ok(!output.join("").includes("Warning: the model never called a tool"));
    // the second request carries a real tool call and its result, not the raw JSON
    const assistant = sent[1].messages.find((message) => message.role === "assistant");

    assert.equal(assistant?.content, null);
    assert.equal(assistant?.tool_calls?.length, 1);
    assert.ok(sent[1].messages.some((message) => message.role === "tool"));
  });

  it("warns when a model finishes without ever calling a tool, and still succeeds", async () => {
    const output: string[] = [];

    replies("I would add a console.log to test.js.");

    const result = await run(output);

    assert.equal(result.exitCode, 0);
    assert.match(output.join(""), /Warning: the model never called a tool/);
  });

  it("does not warn after a real tool call", async () => {
    const output: string[] = [];

    replies({ tool_calls: [{ id: "c1", function: { name: "list_files", arguments: "{}" } }] }, "ok");
    await run(output);

    assert.ok(!output.join("").includes("Warning: the model never called a tool"));
  });
});
