import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_RECENT_THREAD_CHANNEL_CANDIDATES,
  recentThreadCandidateChannelIds,
  shouldQuerySidebarChannel,
} from "./sidebarThreadCandidates.ts";

test("startup candidates are deduplicated, recent-first, and globally capped", () => {
  const activity = Array.from(
    { length: MAX_RECENT_THREAD_CHANNEL_CANDIDATES + 4 },
    (_, index) => ({ channelId: `channel-${index}`, createdAt: index }),
  );
  activity.push({ channelId: "channel-0", createdAt: 10_000 });

  const candidates = recentThreadCandidateChannelIds(activity);
  assert.equal(candidates.size, MAX_RECENT_THREAD_CHANNEL_CANDIDATES);
  assert.ok(candidates.has("channel-0"));
  assert.ok(candidates.has(`channel-${activity.length - 2}`));
  assert.ok(!candidates.has("channel-1"));
});

test("the selected channel is queried even outside startup candidates", () => {
  const candidates = new Set(["recent"]);
  assert.equal(
    shouldQuerySidebarChannel("selected", "selected", candidates),
    true,
  );
  assert.equal(
    shouldQuerySidebarChannel(undefined, "recent", candidates),
    true,
  );
  assert.equal(
    shouldQuerySidebarChannel(undefined, "other", candidates),
    false,
  );
});
