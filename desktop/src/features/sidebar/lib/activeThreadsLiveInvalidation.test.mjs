import assert from "node:assert/strict";
import test from "node:test";

import { activeThreadsLiveInvalidationFilters } from "./activeThreadsLiveInvalidation.ts";

const channelId = "channel-selected";
const rootId = "aa".repeat(32);
const parentId = "bb".repeat(32);

function query(queryKey) {
  return { queryKey };
}

test("nested live replies invalidate only the matching selected-channel cache family", () => {
  const filters = activeThreadsLiveInvalidationFilters(channelId, {
    kind: 9,
    tags: [
      ["e", rootId, "", "root"],
      ["e", parentId, "", "reply"],
    ],
  });

  assert.deepEqual(filters?.queryKey, ["sidebar-active-threads"]);
  assert.equal(
    filters?.predicate(
      query([
        "sidebar-active-threads",
        "relay",
        "pubkey",
        "community",
        channelId,
      ]),
    ),
    true,
  );
  assert.equal(
    filters?.predicate(
      query([
        "sidebar-active-threads",
        "relay",
        "pubkey",
        "community",
        "other-channel",
      ]),
    ),
    false,
  );
});

test("thread summaries and deletions refresh active threads while reactions do not", () => {
  assert.ok(
    activeThreadsLiveInvalidationFilters(channelId, { kind: 39_005, tags: [] }),
  );
  assert.ok(
    activeThreadsLiveInvalidationFilters(channelId, { kind: 5, tags: [] }),
  );
  assert.equal(
    activeThreadsLiveInvalidationFilters(channelId, { kind: 7, tags: [] }),
    null,
  );
  assert.equal(
    activeThreadsLiveInvalidationFilters(channelId, { kind: 9, tags: [] }),
    null,
  );
});
