import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";

import { CancelledError } from "../cancelled.js";
import {
  executeTool,
  APPLY_REMINDER,
  listFilesCapped,
  MAX_LIST_CHARS,
  MAX_TOOL_RESULT_CHARS,
  parseTextToolCall,
  runOpenAiCompatible,
  showsCodeWithoutWriting,
  usageReport,
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

describe("usage of an OpenAI-compatible run", () => {
  const realFetch = globalThis.fetch;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "oai-runner-"));
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    rmSync(dir, { recursive: true, force: true });
  });

  const completion = (message: object, usage?: object) =>
    new Response(JSON.stringify({ choices: [{ message: { role: "assistant", ...message } }], ...(usage ? { usage } : {}) }));

  function serve(...replies: Response[]) {
    let i = 0;

    globalThis.fetch = (async () => replies[Math.min(i++, replies.length - 1)].clone()) as typeof fetch;
  }

  const options = { baseUrl: "http://stub.invalid", apiKey: "k", model: "m" };
  const run = (extra: Partial<typeof options> & Record<string, unknown> = {}) =>
    runOpenAiCompatible(dir, "task", { ...options, ...extra }, () => {}, undefined, 5000);

  it("sums the tokens the server reports over every turn, and reports no cost for a free model", async () => {
    serve(
      completion({ content: null, tool_calls: [{ id: "c1", function: { name: "list_files", arguments: "{}" } }] }, { prompt_tokens: 100, completion_tokens: 10 }),
      completion({ content: "done" }, { prompt_tokens: 150, completion_tokens: 20 }),
    );

    const result = await run();

    assert.deepEqual(result.report, {
      usage: { costUsd: null, inputTokens: 250, outputTokens: 30, cacheReadTokens: 0, cacheCreationTokens: 0 },
    });
  });

  it("prices the run from the key's price per million tokens", async () => {
    serve(completion({ content: "done" }, { prompt_tokens: 2_000_000, completion_tokens: 500_000 }));

    const result = await run({ priceInPerMTok: 0.5, priceOutPerMTok: 2 });

    assert.equal(result.report?.usage?.costUsd, 2);
  });

  it("makes nothing up when the server reports no usage", async () => {
    serve(completion({ content: "done" }));

    assert.equal((await run()).report, undefined);
  });

  it("still reports what a run that hit the turn limit used", async () => {
    serve(completion({ content: null, tool_calls: [{ id: "c", function: { name: "list_files", arguments: "{}" } }] }, { prompt_tokens: 10, completion_tokens: 1 }));

    const result = await run();

    assert.equal(result.exitCode, 1);
    assert.equal(result.report?.usage?.inputTokens, 200);
  });
});

describe("usageReport", () => {
  it("prices only the side that has a price, and nothing without tokens", () => {
    assert.equal(usageReport({ input: 1_000_000, output: 1_000_000 }, { priceOutPerMTok: 3 })?.usage?.costUsd, 3);
    assert.equal(usageReport(null, { priceInPerMTok: 1 }), undefined);
  });
});

describe("list_files on a big project", () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "list-files-test-"));

    for (const folder of ["a", "b"]) {
      mkdirSync(join(dir, folder, "deep"), { recursive: true });
      for (let i = 0; i < 400; i++) writeFileSync(join(dir, folder, "deep", `file-number-${String(i).padStart(4, "0")}.ts`), "");
    }
    writeFileSync(join(dir, "README.md"), "");
    mkdirSync(join(dir, "node_modules", "x"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "x", "index.js"), "");
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns a small project whole, sorted, without node_modules", () => {
    const small = mkdtempSync(join(tmpdir(), "list-files-small-"));

    writeFileSync(join(small, "b.ts"), "");
    writeFileSync(join(small, "a.ts"), "");
    mkdirSync(join(small, "node_modules"));
    writeFileSync(join(small, "node_modules", "z.js"), "");

    assert.equal(executeTool(small, "list_files", {}), "a.ts\nb.ts");
    rmSync(small, { recursive: true, force: true });
  });

  it("cuts a huge listing to about MAX_LIST_CHARS and says how many files were left and how to narrow it", () => {
    const listing = listFilesCapped(dir, "");

    assert.ok(listing.length < MAX_LIST_CHARS + 300, String(listing.length));
    assert.match(listing, /\[\d+ more of 801 files not shown: call list_files with a path/);
    assert.ok(listing.startsWith("README.md\n"));
  });

  it("lists one directory when asked, in full if it fits, and says so when there is nothing", () => {
    assert.equal(executeTool(dir, "list_files", { path: "a/deep" }).split("\n").length > 100, true);
    assert.match(executeTool(dir, "list_files", { path: "a" }), /more of 400 files not shown|file-number-0000/);

    const small = mkdtempSync(join(tmpdir(), "list-files-dir-"));

    mkdirSync(join(small, "src"));
    writeFileSync(join(small, "src", "x.ts"), "");
    mkdirSync(join(small, "empty"));

    assert.equal(executeTool(small, "list_files", { path: "src" }), "src/x.ts");
    assert.equal(listFilesCapped(small, "./"), "src/x.ts");
    assert.equal(listFilesCapped(small, "empty"), "(no files under empty)");
    rmSync(small, { recursive: true, force: true });
  });

  it("never leaves the project", () => {
    assert.throws(() => executeTool(dir, "list_files", { path: "../" }), /outside|escape|not allowed/i);
  });
});

describe("a model that shows the change instead of writing it", () => {
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

  const reply = (message: object) => new Response(JSON.stringify({ choices: [{ message: { role: "assistant", ...message } }] }));
  const writeCall = (content: string) => ({
    content: null,
    tool_calls: [{ id: "w", function: { name: "write_file", arguments: JSON.stringify({ path: "test.js", content }) } }],
  });

  function serve(...replies: object[]) {
    const bodies: { messages: { role: string; content?: string | null }[] }[] = [];
    let i = 0;

    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));

      return reply(replies[Math.min(i++, replies.length - 1)]);
    }) as typeof fetch;

    return bodies;
  }

  const run = (output: string[]) =>
    runOpenAiCompatible(dir, "task", { baseUrl: "http://stub.invalid", apiKey: "k", model: "m" }, (chunk) => output.push(chunk), undefined, 5000);

  it("tells it once to apply the change, and takes the edit it then makes", async () => {
    const bodies = serve(
      { content: "Here is the fix:\n```js\nconsole.log(1);\n```" },
      writeCall("console.log(1);\n"),
      { content: "Done." },
    );
    const output: string[] = [];
    const result = await run(output);

    assert.equal(result.exitCode, 0);
    assert.equal(readFileSync(join(dir, "test.js"), "utf-8"), "console.log(1);\n");
    assert.equal(bodies.length, 3);
    assert.equal(bodies[1].messages.at(-1)?.content, APPLY_REMINDER);
    assert.match(output.join(""), /shows a change but no file was written/);
  });

  it("reminds only once: a model that keeps showing code ends the run as it was", async () => {
    const bodies = serve({ content: "```js\nx\n```" });
    const output: string[] = [];
    const result = await run(output);

    assert.equal(result.exitCode, 0);
    assert.equal(bodies.length, 2);
    assert.equal(readFileSync(join(dir, "test.js"), "utf-8"), "// test.js\n");
  });

  it("leaves an answer without code alone, and one that came after a file was written", async () => {
    const plain = serve({ content: "Nothing needs to change here." });

    await run([]);
    assert.equal(plain.length, 1);

    const written = serve(writeCall("a\n"), { content: "Done, the code is now:\n```js\na\n```" });

    await run([]);
    assert.equal(written.length, 2);
    assert.ok(!written.some((body) => body.messages.some((message) => message.content === APPLY_REMINDER)));
  });

  it("knows a code block or a diff when it sees one", () => {
    for (const text of ["```js\nx\n```", "```\nx\n```", "diff --git a/x b/x\n--- a/x", "see:\n@@ -1 +1 @@\n-a\n+b"]) {
      assert.equal(showsCodeWithoutWriting(text), true, text);
    }
    for (const text of ["", null, undefined, "I will change the query in `a.ts` and add `b`.", "No change is needed."]) {
      assert.equal(showsCodeWithoutWriting(text), false, String(text));
    }
  });
});
