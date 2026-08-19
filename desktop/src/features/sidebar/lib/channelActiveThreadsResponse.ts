import type { RelayEvent } from "@/shared/api/types";
import {
  CHANNEL_TIMELINE_CONTENT_KINDS,
  KIND_CHANNEL_THREAD_SUMMARY,
  KIND_CHANNEL_WINDOW_BOUNDS,
} from "@/shared/constants/kinds";

export type ActiveThreadCursor = {
  latestActivityAt: number;
  rootId: string;
};

export type ActiveThreadRow = {
  root: RelayEvent;
  latestActivityAt: number;
  latestReplyAt: number | null;
};

export type ActiveThreadsPage = {
  rows: ActiveThreadRow[];
  hasMore: boolean;
  nextCursor: ActiveThreadCursor | null;
};

type SummaryPayload = {
  last_reply_at: number | null;
  latest_activity_at?: number;
};
type BoundsPayload = {
  has_more: boolean;
  next_cursor: { latest_activity_at?: unknown; id?: unknown } | null;
};

const MAX_SUPPORTED_TIMESTAMP = 253_402_300_799;
const THREAD_ROOT_KINDS = new Set<number>(CHANNEL_TIMELINE_CONTENT_KINDS);

function supportedTimestamp(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_SUPPORTED_TIMESTAMP
  );
}

function tag(event: RelayEvent, name: string): string | null {
  return event.tags.find((candidate) => candidate[0] === name)?.[1] ?? null;
}

function requestKey(
  channelId: string,
  cursor: ActiveThreadCursor | null,
): string {
  return `${channelId}:active-threads:${cursor ? `${cursor.latestActivityAt}:${cursor.rootId.toLowerCase()}` : "head"}`;
}

function parseContent<T>(event: RelayEvent, label: string): T {
  try {
    return JSON.parse(event.content) as T;
  } catch {
    throw new Error(`Invalid active-thread ${label} event ${event.id}.`);
  }
}

/** Parse a server-assembled, explicitly bounded active-thread page. */
export function parseChannelActiveThreadsResponse(
  events: RelayEvent[],
  channelId: string,
  cursor: ActiveThreadCursor | null,
): ActiveThreadsPage {
  const rootById = new Map<string, RelayEvent>();
  for (const event of events) {
    if (!THREAD_ROOT_KINDS.has(event.kind)) continue;
    if (tag(event, "h") !== channelId) {
      throw new Error(
        "Active-thread root does not match the requested channel.",
      );
    }
    if (!rootById.has(event.id)) rootById.set(event.id, event);
  }

  const summaryByRoot = new Map<
    string,
    { latestActivityAt: number; latestReplyAt: number | null }
  >();
  for (const event of events) {
    if (event.kind !== KIND_CHANNEL_THREAD_SUMMARY) continue;
    if (tag(event, "h") !== channelId) {
      throw new Error(
        "Active-thread summary does not match the requested channel.",
      );
    }
    const rootId = tag(event, "e");
    if (!rootId || !rootById.has(rootId)) {
      throw new Error("Active-thread summary does not match a returned root.");
    }
    const payload = parseContent<SummaryPayload>(event, "summary");
    const activity = payload.latest_activity_at ?? payload.last_reply_at;
    if (!supportedTimestamp(activity)) {
      throw new Error("Active-thread summary has no valid latest activity.");
    }
    if (
      payload.last_reply_at !== null &&
      !supportedTimestamp(payload.last_reply_at)
    ) {
      throw new Error("Active-thread summary has an invalid latest reply.");
    }
    if (!summaryByRoot.has(rootId)) {
      summaryByRoot.set(rootId, {
        latestActivityAt: activity,
        latestReplyAt: payload.last_reply_at,
      });
    }
  }

  const boundsEvents = events.filter(
    (event) => event.kind === KIND_CHANNEL_WINDOW_BOUNDS,
  );
  if (boundsEvents.length !== 1) {
    throw new Error(
      "Active-thread response must contain exactly one bounds event.",
    );
  }
  const boundsEvent = boundsEvents[0];
  if (
    tag(boundsEvent, "h") !== channelId ||
    tag(boundsEvent, "d") !== requestKey(channelId, cursor)
  ) {
    throw new Error("Active-thread bounds do not match the request cursor.");
  }
  const bounds = parseContent<BoundsPayload>(boundsEvent, "bounds");
  let nextCursor: ActiveThreadCursor | null = null;
  if (bounds.next_cursor !== null) {
    const latestActivityAt = bounds.next_cursor.latest_activity_at;
    const rootId = bounds.next_cursor.id;
    if (
      !supportedTimestamp(latestActivityAt) ||
      typeof rootId !== "string" ||
      !/^[0-9a-fA-F]{64}$/.test(rootId)
    ) {
      throw new Error("Active-thread bounds contain an incomplete cursor.");
    }
    nextCursor = { latestActivityAt, rootId: rootId.toLowerCase() };
  }
  if (bounds.has_more !== (nextCursor !== null)) {
    throw new Error("Active-thread bounds has_more and cursor disagree.");
  }

  const rows: ActiveThreadRow[] = [];
  for (const [rootId, root] of rootById) {
    const summary = summaryByRoot.get(rootId);
    if (summary) rows.push({ root, ...summary });
  }
  return { rows, hasMore: bounds.has_more, nextCursor };
}
