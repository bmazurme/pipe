import { describe, it, after } from "node:test";
import assert from "node:assert/strict";

import { WorkerBridgeClient } from "./bridgeClient.js";

const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

describe("WorkerBridgeClient", () => {
  describe("claim", () => {
    it("sends the worker name and returns the claimed job", async () => {
      let capturedUrl: string | undefined;
      let capturedBody: unknown;

      globalThis.fetch = (async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
        return new Response(JSON.stringify({ id: 1, status: "claimed" }), {
          status: 200,
        });
      }) as typeof fetch;

      const client = new WorkerBridgeClient("http://bridge.local", "brk_test");
      const job = await client.claim("worker-1");

      assert.equal(capturedUrl, "http://bridge.local/api/v1/worker/jobs/claim");
      assert.deepEqual(capturedBody, { workerName: "worker-1" });
      assert.equal(job?.id, 1);
    });

    // Regression test: bridge actually sends 204 with a genuinely empty
    // body for "nothing to claim" (a bare `return null` from a Nest
    // handler doesn't serialize to JSON "null" — it sends no body and no
    // content-type at all). A naive `await response.json()` throws
    // "Unexpected end of JSON input" on that empty body — this is exactly
    // what broke worker's very first real deployment.
    it("returns null when nothing is queued (bridge sends 204, no body)", async () => {
      globalThis.fetch = (async () =>
        new Response(null, { status: 204 })) as typeof fetch;

      const client = new WorkerBridgeClient("http://bridge.local", "brk_test");
      assert.equal(await client.claim("worker-1"), null);
    });

    // Same case, pre-fix bridge behavior: an empty body with 201 rather
    // than 204 — the client doesn't assume a specific status code for
    // "empty", so this must also work against a bridge that hasn't
    // redeployed the 204 fix yet.
    it("returns null when nothing is queued (older bridge: empty body, 201)", async () => {
      globalThis.fetch = (async () =>
        new Response(null, { status: 201 })) as typeof fetch;

      const client = new WorkerBridgeClient("http://bridge.local", "brk_test");
      assert.equal(await client.claim("worker-1"), null);
    });

    it("throws with the response status on failure", async () => {
      globalThis.fetch = (async () =>
        new Response("nope", { status: 500 })) as typeof fetch;

      const client = new WorkerBridgeClient("http://bridge.local", "brk_test");
      await assert.rejects(client.claim("worker-1"), /Claim failed \(500\)/);
    });
  });

  describe("updateStatus", () => {
    it("posts the status and error message", async () => {
      let capturedBody: unknown;

      globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
        return new Response("{}", { status: 200 });
      }) as typeof fetch;

      const client = new WorkerBridgeClient("http://bridge.local", "brk_test");
      await client.updateStatus(1, "failed", "boom");

      assert.deepEqual(capturedBody, {
        status: "failed",
        errorMessage: "boom",
      });
    });

    const sequence = (steps: Array<number | "network" | "timeout">) => {
      let calls = 0;
      globalThis.fetch = (async () => {
        const step = steps[calls++];
        if (step === "network") throw new TypeError("fetch failed");
        if (step === "timeout")
          throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
        return new Response("{}", { status: step });
      }) as typeof fetch;
      return () => calls;
    };
    const client = () =>
      new WorkerBridgeClient("http://bridge.local", "brk_test");

    it("retries a terminal status after 503, a network error and a timeout", async () => {
      const calls = sequence([503, "network", "timeout", 200]);
      await client().updateStatus(1, "failed", "boom", undefined, [0, 0, 0]);
      assert.equal(calls(), 4);
    });

    it("does not retry 400/403/404", async () => {
      for (const status of [400, 403, 404]) {
        const calls = sequence([status, 200]);
        await assert.rejects(
          client().updateStatus(1, "cancelled", undefined, undefined, [0, 0]),
        );
        assert.equal(calls(), 1);
      }
    });

    it("repeats a report rejected with 400 once without failureKind", async () => {
      const bodies: unknown[] = [];
      globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(init?.body as string));
        return new Response("bad", { status: bodies.length === 1 ? 400 : 200 });
      }) as typeof fetch;

      await client().updateStatus(1, "failed", "boom", "network", [0]);

      assert.equal(bodies.length, 2);
      assert.equal((bodies[0] as { failureKind?: string }).failureKind, "network");
      assert.equal((bodies[1] as { failureKind?: string }).failureKind, undefined);
    });

    it("throws once the delays are used up", async () => {
      const calls = sequence([503, 503, 503]);
      await assert.rejects(
        client().updateStatus(1, "succeeded", undefined, undefined, [0, 0]),
        /503/,
      );
      assert.equal(calls(), 3);
    });

    it("treats a 409 on a retry as delivered, but not on the first attempt", async () => {
      sequence([503, 409]);
      await client().updateStatus(1, "failed", "boom", undefined, [0]);

      const calls = sequence([409, 200]);
      await assert.rejects(
        client().updateStatus(1, "failed", "boom", undefined, [0]),
        /409/,
      );
      assert.equal(calls(), 1);
    });

    it("retries running after a 503, and treats a 409 on a retry as delivered", async () => {
      const calls = sequence([503, 200]);
      await client().updateStatus(1, "running", undefined, undefined, [0]);
      assert.equal(calls(), 2);

      sequence([503, 409]);
      await client().updateStatus(1, "running", undefined, undefined, [0]);
    });
  });

  describe("downloadParcel retries", () => {
    it("succeeds after one network failure and one 503", async () => {
      let n = 0;
      globalThis.fetch = (async () => {
        n++;
        if (n === 1) throw new TypeError("fetch failed");
        if (n === 2) return new Response("down", { status: 503 });
        return new Response("zipbytes", { status: 200 });
      }) as typeof fetch;

      const buffer = await new WorkerBridgeClient(
        "http://bridge.local",
        "brk_test",
      ).downloadParcel(5, [0, 0]);
      assert.equal(buffer.toString(), "zipbytes");
      assert.equal(n, 3);
    });

    it("does not retry a 404", async () => {
      let n = 0;
      globalThis.fetch = (async () => {
        n++;
        return new Response("missing", { status: 404 });
      }) as typeof fetch;

      await assert.rejects(
        new WorkerBridgeClient(
          "http://bridge.local",
          "brk_test",
        ).downloadParcel(5, [0, 0]),
        /404/,
      );
      assert.equal(n, 1);
    });
  });

  describe("isCancelRequested (cancel-state endpoint)", () => {
    const respondWith = (body: unknown) => {
      let capturedUrl: string | undefined;
      globalThis.fetch = (async (url: string) => {
        capturedUrl = url;
        return new Response(JSON.stringify(body), { status: 200 });
      }) as typeof fetch;
      return () => capturedUrl;
    };

    it("polls the lightweight cancel-state URL", async () => {
      const url = respondWith({
        id: 4,
        status: "running",
        cancelRequestedAt: null,
      });
      const client = new WorkerBridgeClient("http://bridge.local", "brk_test");

      assert.equal(await client.isCancelRequested(4), false);
      assert.equal(
        url(),
        "http://bridge.local/api/v1/worker/jobs/4/cancel-state",
      );
    });

    it("is true when status is cancelled", async () => {
      respondWith({ id: 4, status: "cancelled", cancelRequestedAt: null });
      const client = new WorkerBridgeClient("http://bridge.local", "brk_test");

      assert.equal(await client.isCancelRequested(4), true);
    });

    it("is true when cancelRequestedAt is set", async () => {
      respondWith({
        id: 4,
        status: "running",
        cancelRequestedAt: "2026-01-01T00:00:00.000Z",
      });
      const client = new WorkerBridgeClient("http://bridge.local", "brk_test");

      assert.equal(await client.isCancelRequested(4), true);
    });
  });

  describe("uploadResult retry", () => {
    const client = new WorkerBridgeClient("http://bridge.local", "brk_test");
    const upload = (delays: number[]) =>
      client.uploadResult(1, "r.zip", Buffer.from("x"), delays);

    it("retries after a 503", async () => {
      let calls = 0;
      globalThis.fetch = (async () => {
        calls++;
        return calls === 1
          ? new Response("down", { status: 503 })
          : new Response("{}", { status: 200 });
      }) as typeof fetch;

      await upload([0, 0]);
      assert.equal(calls, 2);
    });

    it("retries after a network error", async () => {
      let calls = 0;
      globalThis.fetch = (async () => {
        calls++;
        if (calls === 1) throw new TypeError("fetch failed");
        return new Response("{}", { status: 200 });
      }) as typeof fetch;

      await upload([0, 0]);
      assert.equal(calls, 2);
    });

    it("does not retry a 400 or 404", async () => {
      for (const status of [400, 404]) {
        let calls = 0;
        globalThis.fetch = (async () => {
          calls++;
          return new Response("bad", { status });
        }) as typeof fetch;

        await assert.rejects(
          upload([0, 0]),
          new RegExp(`failed \\(${status}\\): bad`),
        );
        assert.equal(calls, 1);
      }
    });

    it("throws the last error once attempts are exhausted", async () => {
      let calls = 0;
      globalThis.fetch = (async () =>
        new Response(`n${++calls}`, { status: 502 })) as typeof fetch;

      await assert.rejects(
        upload([0, 0]),
        /Uploading result for job 1 failed \(502\): n3/,
      );
      assert.equal(calls, 3);
    });
  });

  describe("appendLog", () => {
    it("posts the chunk", async () => {
      let capturedBody: unknown;

      globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
        return new Response(null, { status: 204 });
      }) as typeof fetch;

      const client = new WorkerBridgeClient("http://bridge.local", "brk_test");
      await client.appendLog(1, "hello\n");

      assert.deepEqual(capturedBody, { chunk: "hello\n" });
    });
  });
});
