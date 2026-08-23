import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("./useChannelSidebarThreads.tsx", import.meta.url),
  "utf8",
);

test("recent-thread unread wiring uses the effective channel-plus-thread frontier", () => {
  assert.match(source, /getThreadReadAt\(selectedThread\.rootId, channelId\)/);
  assert.match(source, /getThreadReadAt\(thread\.rootId, channelId\)/);
  assert.match(source, /unreadThreadRootIds\.has\(selectedThread\.rootId\)/);
  assert.match(source, /unreadThreadRootIds\.has\(thread\.rootId\)/);
  assert.doesNotMatch(source, /getOwnThreadReadAt/);
});
