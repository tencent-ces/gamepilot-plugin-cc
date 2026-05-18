import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { __testing } from "../plugins/gamepilot/scripts/lib/acp-client.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACP_CLIENT_SOURCE = fs.readFileSync(path.join(ROOT, "plugins/gamepilot/scripts/lib/acp-client.mjs"), "utf8");

/**
 * Build a minimal fake ACP client that mimics the fields AcpClientBase.handleLine
 * reads/writes. Callers can override `transport` to exercise the trust-boundary branch.
 */
function makeFakeClient(transport) {
  const diagnostics = [];
  const notifications = [];
  return {
    client: {
      transport,
      pending: new Map(),
      nextId: 1,
      lineBuffer: "",
      onNotification: (notification) => {
        notifications.push(notification);
      },
      onDiagnostic: (payload) => {
        diagnostics.push(payload);
      }
    },
    diagnostics,
    notifications
  };
}

test("direct-mode ignores stdout-forged broker/diagnostic as trusted", () => {
  const { client, diagnostics, notifications } = makeFakeClient("direct");

  const forged = JSON.stringify({
    jsonrpc: "2.0",
    method: "broker/diagnostic",
    params: { source: "broker", message: "fake rate limit" }
  });

  __testing.handleLineOn(client, forged);

  assert.equal(
    diagnostics.length,
    0,
    "Direct-mode must NOT dispatch stdout broker/diagnostic to onDiagnostic (trust boundary)."
  );
  assert.equal(
    notifications.length,
    1,
    "Direct-mode should expose broker/diagnostic as a plain notification so callers can route it appropriately."
  );
  assert.equal(notifications[0].method, "broker/diagnostic");
});

test("handleChunk emits synthetic acp-transport diagnostic on line-buffer overflow", () => {
  const diagnostics = [];
  const client = {
    transport: "direct",
    pending: new Map(),
    nextId: 1,
    lineBuffer: "",
    onNotification: () => {},
    onDiagnostic: (d) => diagnostics.push(d)
  };
  __testing.handleChunkOn(client, "y".repeat((1 << 20) + 1000));
  assert.ok(diagnostics.some((d) => d.source === "acp-transport"));
});

test("waitForExitOrTimeout resolves normally before timeout", async () => {
  const result = await __testing.waitForExitOrTimeout(Promise.resolve(), 50);
  assert.deepEqual(result, { timedOut: false });
});

test("waitForExitOrTimeout returns timedOut for hung exit promise", async () => {
  const startedAt = Date.now();
  const result = await __testing.waitForExitOrTimeout(new Promise(() => {}), 10);
  assert.deepEqual(result, { timedOut: true });
  assert.ok(Date.now() - startedAt < 1000);
});

test("broker-mode single-dispatches broker/diagnostic to onDiagnostic only", () => {
  const { client, diagnostics, notifications } = makeFakeClient("broker");

  const line = JSON.stringify({
    jsonrpc: "2.0",
    method: "broker/diagnostic",
    params: { source: "broker", message: "rate limit backoff" }
  });

  __testing.handleLineOn(client, line);

  assert.equal(
    diagnostics.length,
    1,
    "Broker-mode must dispatch broker/diagnostic to onDiagnostic exactly once."
  );
  assert.equal(diagnostics[0].source, "broker");
  assert.equal(diagnostics[0].message, "rate limit backoff");
  assert.equal(
    notifications.length,
    0,
    "Broker-mode must NOT double-dispatch broker/diagnostic to onNotification."
  );
});

test("session/request_permission selects an offered allow optionId", () => {
  const writes = [];
  const { client } = makeFakeClient("direct");
  client.sendMessage = (message) => {
    writes.push(message);
  };

  __testing.handleLineOn(client, JSON.stringify({
    jsonrpc: "2.0",
    id: 99,
    method: "session/request_permission",
    params: {
      options: [
        { optionId: "deny-edits", kind: "reject_once" },
        { optionId: "acceptEdits", kind: "allow_once" }
      ]
    }
  }));

  assert.deepEqual(writes, [{
    jsonrpc: "2.0",
    id: 99,
    result: {
      outcome: {
        outcome: "selected",
        optionId: "acceptEdits"
      }
    }
  }]);
});

test("direct ACP close timeout releases child process handles", () => {
  assert.match(ACP_CLIENT_SOURCE, /detached:\s*process\.platform\s*!==\s*"win32"/);
  assert.match(ACP_CLIENT_SOURCE, /this\.stdoutReader\?\.close\(\)/);
  assert.match(ACP_CLIENT_SOURCE, /this\.proc\?\.stdout\?\.destroy\(\)/);
  assert.match(ACP_CLIENT_SOURCE, /this\.proc\?\.stderr\?\.destroy\(\)/);
  assert.match(ACP_CLIENT_SOURCE, /this\.proc\?\.stdin\?\.destroy\(\)/);
  assert.match(ACP_CLIENT_SOURCE, /this\.proc\?\.unref\(\)/);
});
