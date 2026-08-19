import assert from "node:assert/strict";
import test from "node:test";

import { parseChannelActiveThreadsResponse } from "./channelActiveThreadsResponse.ts";

const channelId = "11111111-1111-4111-8111-111111111111";
const root = (id, content, created_at = 10, kind = 9) => ({
  id,
  pubkey: "aa".repeat(32),
  created_at,
  kind,
  tags: [["h", channelId]],
  content,
  sig: "bb".repeat(64),
});
const summary = (
  rootId,
  latestActivityAt,
  latestReplyAt = latestActivityAt,
) => ({
  id: `summary-${rootId}`,
  pubkey: "cc".repeat(32),
  created_at: latestActivityAt,
  kind: 39005,
  tags: [
    ["h", channelId],
    ["e", rootId],
  ],
  content: JSON.stringify({
    reply_count: 1,
    descendant_count: 1,
    last_reply_at: latestReplyAt,
    latest_activity_at: latestActivityAt,
    participants: [],
  }),
  sig: "dd".repeat(64),
});
const bounds = (hasMore, cursor) => ({
  id: "bounds",
  pubkey: "cc".repeat(32),
  created_at: 20,
  kind: 39006,
  tags: [
    ["h", channelId],
    ["d", `${channelId}:active-threads:head`],
  ],
  content: JSON.stringify({ has_more: hasMore, next_cursor: cursor }),
  sig: "dd".repeat(64),
});

test("parses authoritative thread rows and explicit bounds in wire order", () => {
  const a = "01".repeat(32);
  const b = "02".repeat(32);
  const page = parseChannelActiveThreadsResponse(
    [
      root(a, "older root"),
      summary(a, 200),
      root(b, "newer root"),
      summary(b, 300),
      bounds(true, { latest_activity_at: 200, id: a }),
    ],
    channelId,
    null,
  );
  assert.deepEqual(
    page.rows.map((row) => [
      row.root.id,
      row.latestActivityAt,
      row.latestReplyAt,
    ]),
    [
      [a, 200, 200],
      [b, 300, 300],
    ],
  );
  assert.equal(page.hasMore, true);
  assert.deepEqual(page.nextCursor, { latestActivityAt: 200, rootId: a });
});

test("preserves a null latest reply for roots without replies", () => {
  const id = "03".repeat(32);
  const page = parseChannelActiveThreadsResponse(
    [root(id, "thread leaf"), summary(id, 100, null), bounds(false, null)],
    channelId,
    null,
  );
  assert.equal(page.rows[0].latestActivityAt, 100);
  assert.equal(page.rows[0].latestReplyAt, null);
});

test("accepts current kind-40002 stream roots returned by the relay", () => {
  const id = "04".repeat(32);
  const page = parseChannelActiveThreadsResponse(
    [
      root(id, "current stream root", 10, 40002),
      summary(id, 100),
      bounds(false, null),
    ],
    channelId,
    null,
  );
  assert.equal(page.rows.length, 1);
  assert.equal(page.rows[0].root.kind, 40002);
  assert.equal(page.rows[0].root.content, "current stream root");
});

test("rejects mismatched overlays and incomplete cursors", () => {
  const id = "01".repeat(32);
  const wrong = summary(id, 200);
  wrong.tags[0][1] = "22222222-2222-4222-8222-222222222222";
  assert.throws(
    () =>
      parseChannelActiveThreadsResponse(
        [root(id, "root"), wrong, bounds(false, null)],
        channelId,
        null,
      ),
    /channel/,
  );

  assert.throws(
    () =>
      parseChannelActiveThreadsResponse(
        [
          root(id, "root"),
          summary(id, 200),
          bounds(true, { latest_activity_at: 200 }),
        ],
        channelId,
        null,
      ),
    /cursor/,
  );
});

test("deduplicates roots deterministically and never infers exhaustion from row count", () => {
  const id = "01".repeat(32);
  const page = parseChannelActiveThreadsResponse(
    [
      root(id, "first"),
      summary(id, 200),
      root(id, "duplicate"),
      summary(id, 200),
      bounds(false, null),
    ],
    channelId,
    null,
  );
  assert.equal(page.rows.length, 1);
  assert.equal(page.rows[0].root.content, "first");
  assert.equal(page.hasMore, false);
});

test("rejects malformed cursor ids and unsupported timestamps", () => {
  const id = "01".repeat(32);
  const malformed = [
    { latest_activity_at: 200, id: "g".repeat(64) },
    { latest_activity_at: 200.5, id },
    { latest_activity_at: Number.POSITIVE_INFINITY, id },
    { latest_activity_at: -1, id },
    { latest_activity_at: 8_640_000_000_000, id },
  ];
  for (const cursor of malformed) {
    assert.throws(
      () =>
        parseChannelActiveThreadsResponse(
          [root(id, "root"), summary(id, 200), bounds(true, cursor)],
          channelId,
          null,
        ),
      /cursor/,
    );
  }
});

test("normalizes valid uppercase cursor ids", () => {
  const id = "AB".repeat(32);
  const page = parseChannelActiveThreadsResponse(
    [
      root(id, "root"),
      summary(id, 200),
      bounds(true, { latest_activity_at: 200, id }),
    ],
    channelId,
    null,
  );
  assert.equal(page.nextCursor.rootId, id.toLowerCase());
});
