import assert from "node:assert/strict";
import { test } from "node:test";

import {
  activeThreadsQueryKey,
  fetchActiveThreadsPage,
  shouldQuerySidebarChannel,
} from "./channelActiveThreadsQuery.ts";

const scope = {
  relayUrl: "wss://relay.example/",
  communityId: "COMMUNITY",
  pubkey: "ABCDEF",
};

test("query keys fence scope and channel but remain stable as wall time advances", () => {
  const key = activeThreadsQueryKey(scope, "channel-1", "3d");
  assert.deepEqual(key, [
    "sidebar-active-threads",
    "wss://relay.example",
    "abcdef",
    "community",
    "channel-1",
    "3d",
  ]);
  assert.deepEqual(activeThreadsQueryKey(scope, "channel-1", "3d"), key);
});

test("one query invocation fetches exactly one bounded server page", async () => {
  const cursors = [];
  const root = (id, latestActivityAt) => ({
    root: {
      id,
      kind: 9,
      pubkey: "p",
      created_at: 1,
      tags: [["h", "channel-1"]],
      content: id,
      sig: "s",
    },
    latestActivityAt,
  });
  const requestPage = async ({ cursor, limitRows }) => {
    cursors.push(cursor);
    assert.equal(limitRows, 50);
    return {
      rows: [root("b", 20), root("a", 15)],
      hasMore: true,
      nextCursor: { latestActivityAt: 15, rootId: "a" },
    };
  };

  const page = await fetchActiveThreadsPage({
    channelId: "channel-1",
    activeSince: 0,
    cursor: null,
    requestPage,
  });

  assert.deepEqual(cursors, [null]);
  assert.equal(page.rows.length, 2);
  assert.equal(page.hasMore, true);
});

test("bounded page fetch ignores completion after identity cancellation", async () => {
  const controller = new AbortController();
  const pending = fetchActiveThreadsPage({
    channelId: "channel-1",
    activeSince: 0,
    cursor: null,
    signal: controller.signal,
    requestPage: async () => {
      controller.abort();
      return { rows: [], hasMore: false, nextCursor: null };
    },
  });
  await assert.rejects(pending, (error) => error?.name === "AbortError");
});

test("sidebar query budget enables only the selected channel", () => {
  assert.equal(shouldQuerySidebarChannel("channel-1", "channel-1"), true);
  assert.equal(shouldQuerySidebarChannel("channel-1", "channel-2"), false);
  assert.equal(shouldQuerySidebarChannel(null, "channel-1"), false);
});
