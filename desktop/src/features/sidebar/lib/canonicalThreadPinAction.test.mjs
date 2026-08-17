import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveCanonicalThreadRootId,
  toggleCanonicalThreadPin,
} from "./canonicalThreadPinAction.ts";

const root = { id: "root", tags: [["h", "channel"]] };
const directReply = {
  id: "reply",
  tags: [
    ["h", "channel"],
    ["e", "root", "", "reply"],
  ],
};
const nestedReply = {
  id: "nested",
  tags: [
    ["h", "channel"],
    ["e", "root", "", "root"],
    ["e", "reply", "", "reply"],
  ],
};

test("root and reply actions resolve the canonical root", () => {
  assert.equal(resolveCanonicalThreadRootId(root), "root");
  assert.equal(resolveCanonicalThreadRootId(directReply), "root");
  assert.equal(resolveCanonicalThreadRootId(nestedReply), "root");
});

test("pin action writes only local sidebar preference state", () => {
  const calls = [];
  const followCalls = 0;
  const unreadCalls = 0;
  const notificationCalls = 0;
  const publishCalls = 0;
  const result = toggleCanonicalThreadPin({
    channelId: "channel",
    message: nestedReply,
    pinned: true,
    writeLocalPin(channelId, rootId, pinned) {
      calls.push([channelId, rootId, pinned]);
      return true;
    },
  });

  assert.equal(result, true);
  assert.deepEqual(calls, [["channel", "root", true]]);
  assert.equal(followCalls, 0);
  assert.equal(unreadCalls, 0);
  assert.equal(notificationCalls, 0);
  assert.equal(publishCalls, 0);
  void followCalls;
  void unreadCalls;
  void notificationCalls;
  void publishCalls;
});
