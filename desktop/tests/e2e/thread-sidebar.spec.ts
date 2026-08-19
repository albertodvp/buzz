import { expect, test, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const FRESH_ROOT = "mock-general-welcome";
const SECOND_ROOT = "mock-general-alice";
const OLD_ROOT = "bb".repeat(32);
const MOCK_PUBKEY = "deadbeef".repeat(8);

function getHashSearchParam(page: Page, name: string) {
  const hash = new URL(page.url()).hash.replace(/^#/, "");
  const queryStart = hash.indexOf("?");
  if (queryStart === -1) return null;
  return new URLSearchParams(hash.slice(queryStart + 1)).get(name);
}

async function chooseInactivity(page: Page, label: string) {
  await page.getByTestId("channel-general").click({ button: "right" });
  const inactivityItem = page.getByRole("menuitem", {
    name: "Hide threads after inactivity",
  });
  const iconBox = await inactivityItem
    .locator("[data-sidebar-context-icon-slot]")
    .boundingBox();
  const labelBox = await inactivityItem
    .getByText("Hide threads after inactivity", { exact: true })
    .boundingBox();
  if (!iconBox || !labelBox) throw new Error("Inactivity menu row is hidden");
  expect(labelBox.x - (iconBox.x + iconBox.width)).toBeLessThanOrEqual(10);
  await inactivityItem.hover();
  await page.getByRole("menuitemradio", { name: label }).click();
}

async function waitForGeneralLiveSubscription(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
          channelName: "general",
        }),
      ),
    )
    .toBe(true);
}

test("recent threads bootstrap while Inbox is selected", async ({ page }) => {
  const now = Math.floor(Date.now() / 1000);
  await installMockBridge(page, {
    activeThreads: {
      [GENERAL_CHANNEL_ID]: [
        {
          rootId: FRESH_ROOT,
          content: "Fresh release discussion",
          kind: 40002,
          latestActivityAt: now - 60,
        },
      ],
    },
  });
  await page.goto("/");

  await expect(page.getByTestId(`sidebar-thread-${FRESH_ROOT}`)).toBeVisible();
  expect(new URL(page.url()).hash).not.toContain("/channels/");
});

test("recent threads remain visible in a custom section", async ({ page }) => {
  const now = Math.floor(Date.now() / 1000);
  await page.addInitScript(
    ({ channelId, pubkey }) => {
      localStorage.setItem(
        `buzz-channel-sections.v1:${pubkey}`,
        JSON.stringify({
          version: 1,
          sections: [{ id: "threads", name: "Thread projects", order: 0 }],
          assignments: { [channelId]: "threads" },
        }),
      );
    },
    { channelId: GENERAL_CHANNEL_ID, pubkey: MOCK_PUBKEY },
  );
  await installMockBridge(page, {
    activeThreads: {
      [GENERAL_CHANNEL_ID]: [
        {
          rootId: FRESH_ROOT,
          content: "Custom section discussion",
          latestActivityAt: now - 60,
        },
      ],
    },
  });
  await page.goto("/");

  await expect(page.getByText("Thread projects")).toBeVisible();
  await expect(page.getByTestId(`sidebar-thread-${FRESH_ROOT}`)).toBeVisible();
});

test("background live replies invalidate candidate thread rows", async ({
  page,
}) => {
  const now = Math.floor(Date.now() / 1000);
  await installMockBridge(page, {
    activeThreads: { [GENERAL_CHANNEL_ID]: [] },
  });
  await page.goto("/");
  await expect(page.getByTestId(`sidebar-thread-${FRESH_ROOT}`)).toHaveCount(0);
  await waitForGeneralLiveSubscription(page);

  await page.evaluate(
    ({ channelId, rootId, latestActivityAt }) => {
      window.__BUZZ_E2E_SET_ACTIVE_THREADS__?.(channelId, [
        {
          rootId,
          content: "Background reply discussion",
          latestActivityAt,
        },
      ]);
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content: "A background reply",
        parentEventId: rootId,
        createdAt: latestActivityAt,
      });
    },
    {
      channelId: GENERAL_CHANNEL_ID,
      rootId: FRESH_ROOT,
      latestActivityAt: now,
    },
  );

  await expect(page.getByTestId(`sidebar-thread-${FRESH_ROOT}`)).toBeVisible();
  expect(new URL(page.url()).hash).not.toContain("/channels/");
});

test("recent thread sidebar keeps activity filtering and canonical navigation separate", async ({
  page,
}, testInfo) => {
  const now = Math.floor(Date.now() / 1000);
  await page.addInitScript(() => {
    localStorage.setItem("buzz.channels.threadViewMode", "split");
  });
  await installMockBridge(page, {
    activeThreads: {
      [GENERAL_CHANNEL_ID]: [
        {
          rootId: FRESH_ROOT,
          content: "Fresh release discussion",
          latestActivityAt: now - 60,
        },
        {
          rootId: OLD_ROOT,
          content: "Long-running architecture decision",
          latestActivityAt: now - 10 * 24 * 60 * 60,
        },
      ],
    },
  });
  await page.goto("/");
  await page.getByTestId("channel-general").click();

  const fresh = page.getByTestId(`sidebar-thread-${FRESH_ROOT}`);
  const old = page.getByTestId(`sidebar-thread-${OLD_ROOT}`);
  await expect(fresh).toBeVisible();
  await expect(old).toHaveCount(0);

  await chooseInactivity(page, "Never");
  await expect(old).toBeVisible();

  await chooseInactivity(page, "3 days");
  await expect(old).toHaveCount(0);

  await fresh.click();
  await expect.poll(() => getHashSearchParam(page, "thread")).toBe(FRESH_ROOT);
  await expect(fresh).toHaveAttribute("aria-current", "page");
  await expect(fresh).toHaveAttribute("data-active", "true");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("buzz.channels.threadViewMode")),
    )
    .toBe("focus");
  await expect(page.getByTestId("focus-thread-drawer")).toBeVisible();

  await waitForAnimations(page);
  await page.getByTestId("app-sidebar").screenshot({
    path: testInfo.outputPath("thread-sidebar-selected.png"),
  });
  await page.getByTestId("focus-thread-drawer").screenshot({
    path: testInfo.outputPath("thread-sidebar-focus.png"),
  });

  await fresh.click();
  await expect(page.getByTestId("focus-thread-drawer-overlay")).toHaveCount(0);
  await expect(fresh).not.toHaveAttribute("aria-current", "page");
  await expect(fresh).not.toHaveAttribute("data-active", "true");
  await expect.poll(() => getHashSearchParam(page, "thread")).toBeNull();
});

test("recent thread unread dots clear only when that thread is opened", async ({
  page,
}) => {
  const now = Math.floor(Date.now() / 1000);
  await installMockBridge(page, {
    activeThreads: {
      [GENERAL_CHANNEL_ID]: [
        {
          rootId: FRESH_ROOT,
          content: "Unread release discussion",
          latestActivityAt: now + 60,
        },
        {
          rootId: SECOND_ROOT,
          content: "Unrelated agent session",
          latestActivityAt: now + 61,
        },
      ],
    },
  });
  await page.goto("/");
  await page.getByTestId("channel-general").click();

  const unreadThread = page.getByTestId(`sidebar-thread-${FRESH_ROOT}`);
  const unrelatedThread = page.getByTestId(`sidebar-thread-${SECOND_ROOT}`);
  await expect(unreadThread.getByTestId("sidebar-thread-unread")).toBeVisible();
  await expect(
    unrelatedThread.getByTestId("sidebar-thread-unread"),
  ).toBeVisible();

  await unrelatedThread.click();
  const threadPanel = page.getByTestId("message-thread-panel");
  await expect(threadPanel).toBeVisible();
  await expect(unreadThread.getByTestId("sidebar-thread-unread")).toBeVisible();

  const reply = `Unrelated reply ${Date.now()}`;
  await threadPanel.getByTestId("message-input").fill(reply);
  await threadPanel.getByTestId("send-message").click();
  const replyRow = threadPanel
    .getByTestId("message-thread-replies")
    .getByTestId("message-row")
    .filter({ hasText: reply });
  await expect(replyRow).toBeVisible();
  await expect(unreadThread.getByTestId("sidebar-thread-unread")).toBeVisible();

  const replyId = await replyRow.getAttribute("data-message-id");
  if (!replyId) throw new Error("Sent reply has no message id.");
  await replyRow.hover();
  await replyRow.getByTestId(`more-actions-${replyId}`).click();
  await page.getByTestId(`delete-message-${replyId}`).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  // Production emits a fresh top-level kind:40099 tombstone after deletion.
  // It advances the channel frontier, but must not consume another thread's
  // own unread marker.
  await page.evaluate(
    ({ createdAt }) => {
      (
        window as Window & {
          __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
            channelName: string;
            content: string;
            kind: number;
            createdAt: number;
          }) => unknown;
        }
      ).__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content: JSON.stringify({ type: "message_deleted" }),
        kind: 40099,
        createdAt,
      });
    },
    { createdAt: now + 120 },
  );
  await expect(unreadThread.getByTestId("sidebar-thread-unread")).toBeVisible();

  await unreadThread.click();
  await expect(unreadThread.getByTestId("sidebar-thread-unread")).toHaveCount(
    0,
  );
  await unreadThread.click();
  await expect(page.getByTestId("focus-thread-drawer-overlay")).toHaveCount(0);
  await expect(unreadThread.getByTestId("sidebar-thread-unread")).toHaveCount(
    0,
  );
});
