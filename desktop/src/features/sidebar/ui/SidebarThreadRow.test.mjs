import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  SidebarThreadRow,
  THREAD_INACTIVITY_OPTIONS,
} from "./SidebarThreadRow.tsx";

test("thread row is compact, labelled, selected and exposes unread state", () => {
  const html = renderToStaticMarkup(
    React.createElement(SidebarThreadRow, {
      thread: {
        rootId: "root-1",
        channelId: "channel-1",
        label: "Meaningful thread",
        latestActivityAt: 100,
        latestReplyAt: 100,
      },
      selected: true,
      unread: true,
      onNavigate() {},
    }),
  );
  assert.match(html, /aria-current="page"/);
  assert.match(html, /data-active="true"/);
  assert.match(html, /data-unread="true"/);
  assert.match(html, /Meaningful thread/);
  assert.match(html, /data-testid="sidebar-thread-unread"/);
  assert.match(html, /Unread replies/);
  assert.match(html, /data-testid="sidebar-thread-root-1"/);
});

test("inactivity selector exposes every accepted option with the 3 day default label", () => {
  assert.deepEqual(
    THREAD_INACTIVITY_OPTIONS.map(({ value, label }) => [value, label]),
    [
      ["1d", "1 day"],
      ["3d", "3 days"],
      ["7d", "7 days"],
      ["30d", "30 days"],
      ["never", "Never"],
    ],
  );
});
