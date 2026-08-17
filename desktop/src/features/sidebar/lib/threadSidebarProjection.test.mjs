import assert from "node:assert/strict";
import test from "node:test";

import {
  isThreadSidebarUnread,
  projectThreadSidebarRows,
  threadSidebarCutoff,
} from "./threadSidebarProjection.ts";

const root = (id, content, created_at = 10) => ({
  id,
  pubkey: "aa",
  created_at,
  kind: 9,
  tags: [],
  content,
  sig: "bb",
});
const row = (id, activity, content = id) => ({
  root: root(id, content),
  latestActivityAt: activity,
  latestReplyAt: activity,
});
const prefs = (inactivity, pins = {}) => ({ inactivity, updatedAt: 0, pins });
const pin = (pinned = true) => ({ pinned, updatedAt: 1 });

test("finite windows include fresh rows, exclude expired rows, and pins override age", () => {
  const now = 10 * 86_400;
  const rows = projectThreadSidebarRows(
    [row("fresh", now - 10), row("old", now - 4 * 86_400), row("pinned", 1)],
    prefs("3d", { pinned: pin() }),
    now,
  );
  assert.deepEqual(
    rows.map((item) => item.rootId),
    ["fresh", "pinned"],
  );
  assert.equal(rows[1].pinned, true);
  assert.equal(threadSidebarCutoff("3d", now), now - 3 * 86_400);
});

test("pinned-only excludes unpinned while never retains every authoritative row", () => {
  const input = [row("new", 300), row("old", 100)];
  assert.deepEqual(
    projectThreadSidebarRows(
      input,
      prefs("pinned-only", { old: pin() }),
      999,
    ).map((item) => item.rootId),
    ["old"],
  );
  assert.deepEqual(
    projectThreadSidebarRows(input, prefs("never"), 999).map(
      (item) => item.rootId,
    ),
    ["new", "old"],
  );
});

test("deduplicates and orders by shared activity rather than pin status", () => {
  const input = [
    row("pinned", 100),
    row("new", 300),
    row("pinned", 100, "duplicate"),
  ];
  const result = projectThreadSidebarRows(
    input,
    prefs("never", { pinned: pin() }),
    999,
  );
  assert.deepEqual(
    result.map((item) => item.rootId),
    ["new", "pinned"],
  );
});

test("creates bounded deterministic labels for markdown and media-only roots", () => {
  const long = `**Hello** @person ${"word ".repeat(40)}`;
  const [text, media] = projectThreadSidebarRows(
    [row("text", 2, long), row("media", 1, "")],
    prefs("never"),
    3,
  );
  assert.ok(text.label.startsWith("Hello @person"));
  assert.ok(text.label.length <= 80);
  assert.equal(media.label, "Media thread");
});

test("unread projection requires a reply newer than the effective frontier", () => {
  assert.equal(isThreadSidebarUnread(null, null), false);
  assert.equal(isThreadSidebarUnread(200, null), true);
  assert.equal(isThreadSidebarUnread(200, 199), true);
  assert.equal(isThreadSidebarUnread(200, 200), false);
});
