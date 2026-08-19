import type { ActiveThreadRow } from "./channelActiveThreadsResponse";
import type { ThreadSidebarInactivity } from "./threadSidebarPreferencesStorage";

export type ProjectedSidebarThread = {
  rootId: string;
  channelId: string | null;
  label: string;
  latestActivityAt: number;
  latestReplyAt: number | null;
};

type ChannelPreference = {
  inactivity: ThreadSidebarInactivity;
};

const WINDOW_SECONDS: Partial<Record<ThreadSidebarInactivity, number>> = {
  "1d": 86_400,
  "3d": 3 * 86_400,
  "7d": 7 * 86_400,
  "30d": 30 * 86_400,
};

export function threadSidebarCutoff(
  inactivity: ThreadSidebarInactivity,
  nowSeconds: number,
): number | null {
  const window = WINDOW_SECONDS[inactivity];
  return window === undefined ? null : nowSeconds - window;
}

/** A sidebar row is unread only when the thread has a reply past its frontier. */
export function isThreadSidebarUnread(
  latestReplyAt: number | null,
  readAt: number | null,
): boolean {
  return latestReplyAt !== null && latestReplyAt > (readAt ?? 0);
}

function rootLabel(content: string): string {
  const text = content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`>#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "Media thread";
  return text.length <= 80 ? text : `${text.slice(0, 79).trimEnd()}…`;
}

/** Derive the personal list only from permission-checked authoritative rows. */
export function projectThreadSidebarRows(
  rows: ActiveThreadRow[],
  preference: ChannelPreference,
  nowSeconds: number,
): ProjectedSidebarThread[] {
  const cutoff = threadSidebarCutoff(preference.inactivity, nowSeconds);
  const byRoot = new Map<string, ActiveThreadRow>();
  for (const row of rows) {
    const existing = byRoot.get(row.root.id);
    if (!existing || row.latestActivityAt > existing.latestActivityAt) {
      byRoot.set(row.root.id, row);
    }
  }

  const projected: ProjectedSidebarThread[] = [];
  for (const row of byRoot.values()) {
    const automatic =
      preference.inactivity === "never" ||
      (cutoff !== null && row.latestActivityAt >= cutoff);
    if (!automatic) continue;
    projected.push({
      rootId: row.root.id,
      channelId: row.root.tags.find((tag) => tag[0] === "h")?.[1] ?? null,
      label: rootLabel(row.root.content),
      latestActivityAt: row.latestActivityAt,
      latestReplyAt: row.latestReplyAt,
    });
  }
  projected.sort(
    (left, right) =>
      right.latestActivityAt - left.latestActivityAt ||
      left.rootId.localeCompare(right.rootId),
  );
  return projected;
}
