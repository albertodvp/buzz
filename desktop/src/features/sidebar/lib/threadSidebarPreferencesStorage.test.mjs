import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_THREAD_INACTIVITY,
  parseThreadSidebarPreferences,
  readThreadSidebarPreferences,
  threadSidebarPreferencesKey,
  updateChannelInactivity,
} from "./threadSidebarPreferencesStorage.ts";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    values,
  };
}

const scope = {
  relayUrl: " HTTPS://Relay.Example/ ",
  communityId: "community-a",
  pubkey: "AA",
};

test("defaults channels to 3d without eagerly writing", () => {
  const storage = memoryStorage();
  const state = readThreadSidebarPreferences(scope, storage);
  assert.equal(DEFAULT_THREAD_INACTIVITY, "3d");
  assert.deepEqual(state, { version: 1, channels: {} });
  assert.equal(storage.values.size, 0);
});

test("scope key includes normalized relay, community, and identity", () => {
  assert.equal(
    threadSidebarPreferencesKey(scope),
    "buzz-thread-sidebar-preferences.v1:https://relay.example:community-a:aa",
  );
  assert.notEqual(
    threadSidebarPreferencesKey(scope),
    threadSidebarPreferencesKey({ ...scope, communityId: "community-b" }),
  );
  assert.notEqual(
    threadSidebarPreferencesKey(scope),
    threadSidebarPreferencesKey({ ...scope, pubkey: "bb" }),
  );
});

test("validates all inactivity choices and rejects malformed payloads", () => {
  const choices = ["1d", "3d", "7d", "30d", "never"];
  for (const inactivity of choices) {
    const parsed = parseThreadSidebarPreferences({
      version: 1,
      channels: { c: { inactivity, updatedAt: 1 } },
    });
    assert.equal(parsed.channels.c.inactivity, inactivity);
  }
  assert.equal(
    parseThreadSidebarPreferences({ version: 2, channels: {} }),
    null,
  );
  assert.equal(
    parseThreadSidebarPreferences({
      version: 1,
      channels: { c: { inactivity: "forever" } },
    }),
    null,
  );
});

test("inactivity updates persist and failed storage writes report failure", () => {
  const storage = memoryStorage();
  assert.equal(
    updateChannelInactivity(scope, "channel-a", "30d", storage, 20),
    true,
  );
  assert.equal(
    readThreadSidebarPreferences(scope, storage).channels["channel-a"]
      .inactivity,
    "30d",
  );
  const denied = {
    getItem: () => null,
    setItem: () => {
      throw new Error("denied");
    },
  };
  assert.equal(
    updateChannelInactivity(scope, "channel-a", "7d", denied, 20),
    false,
  );
});

test("128 channels survive reload and a 129th deterministically evicts the oldest", () => {
  const storage = memoryStorage();
  for (let index = 0; index < 128; index += 1) {
    assert.equal(
      updateChannelInactivity(
        scope,
        `channel-${index}`,
        "7d",
        storage,
        index + 1,
      ),
      true,
    );
  }
  let reloaded = readThreadSidebarPreferences(scope, storage);
  assert.equal(Object.keys(reloaded.channels).length, 128);
  assert.ok(reloaded.channels["channel-0"]);

  assert.equal(
    updateChannelInactivity(scope, "channel-128", "30d", storage, 129),
    true,
  );
  reloaded = readThreadSidebarPreferences(scope, storage);
  assert.equal(Object.keys(reloaded.channels).length, 128);
  assert.equal(reloaded.channels["channel-0"], undefined);
  assert.equal(reloaded.channels["channel-128"].inactivity, "30d");
});
