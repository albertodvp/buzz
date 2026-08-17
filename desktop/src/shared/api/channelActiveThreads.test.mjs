import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

const calls = [];
const tauriInternals = {
  invoke(command, args) {
    calls.push({ command, args });
    return Promise.resolve([]);
  },
};
globalThis.window = { __TAURI_INTERNALS__: tauriInternals };
globalThis.__TAURI_INTERNALS__ = tauriInternals;

const { getChannelActiveThreadEvents } = await import(
  "./channelActiveThreads.ts"
);

afterEach(() => calls.splice(0));

test("active thread API forwards the authoritative bounds and composite cursor", async () => {
  await getChannelActiveThreadEvents({
    channelId: "channel-1",
    activeSince: 123,
    limitRows: 40,
    cursor: { latestActivityAt: 456, rootId: "ab".repeat(32) },
  });

  assert.deepEqual(calls, [
    {
      command: "get_active_threads",
      args: {
        channelId: "channel-1",
        activeSince: 123,
        limitRows: 40,
        cursor: { latestActivityAt: 456, rootId: "ab".repeat(32) },
      },
    },
  ]);
});

test("active thread API preserves Never as a null cutoff and head cursor", async () => {
  await getChannelActiveThreadEvents({
    channelId: "channel-1",
    activeSince: null,
  });

  assert.equal(calls[0].args.activeSince, null);
  assert.equal(calls[0].args.cursor, null);
  assert.equal(calls[0].args.limitRows, 50);
});
