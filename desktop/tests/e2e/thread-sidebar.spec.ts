import { expect, test, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const FRESH_ROOT = "mock-general-welcome";
const OLD_ROOT = "bb".repeat(32);

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
  await expect
    .poll(() => ({
      messageId: getHashSearchParam(page, "messageId"),
      threadRootId: getHashSearchParam(page, "threadRootId"),
    }))
    .toEqual({ messageId: FRESH_ROOT, threadRootId: FRESH_ROOT });
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
