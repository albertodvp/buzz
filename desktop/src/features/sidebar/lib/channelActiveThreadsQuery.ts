import { getChannelActiveThreadEvents } from "@/shared/api/channelActiveThreads";
import { normalizeRelayUrl } from "@/shared/lib/normalizeRelayUrl";
import {
  parseChannelActiveThreadsResponse,
  type ActiveThreadCursor,
  type ActiveThreadsPage,
} from "./channelActiveThreadsResponse";
import type {
  ThreadSidebarInactivity,
  ThreadSidebarScope,
} from "./threadSidebarPreferencesStorage";

const ACTIVE_THREAD_PAGE_SIZE = 50;

/** Stable cache identity; wall-clock cutoffs are deliberately not cache keys. */
export function activeThreadsQueryKey(
  scope: ThreadSidebarScope,
  channelId: string,
  inactivity: ThreadSidebarInactivity,
  includedRootIds: string[],
) {
  return [
    "sidebar-active-threads",
    normalizeRelayUrl(scope.relayUrl),
    scope.pubkey.toLowerCase(),
    scope.communityId.toLowerCase(),
    channelId,
    inactivity,
    ...includedRootIds.map((rootId) => rootId.toLowerCase()).sort(),
  ] as const;
}

export function shouldQuerySidebarChannel(
  selectedChannelId: string | null | undefined,
  candidateChannelId: string,
  hasBookmarks = false,
): boolean {
  return selectedChannelId === candidateChannelId || hasBookmarks;
}

type PageRequest = {
  channelId: string;
  activeSince: number | null;
  includedRootIds: string[];
  cursor: ActiveThreadCursor | null;
  limitRows: number;
};

type FetchPageInput = Omit<PageRequest, "limitRows"> & {
  signal?: AbortSignal;
  requestPage?: (input: PageRequest) => Promise<ActiveThreadsPage>;
};

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

/** Fetch exactly one finite server page; pagination is owned by the UI. */
export async function fetchActiveThreadsPage({
  channelId,
  activeSince,
  includedRootIds,
  cursor,
  signal,
  requestPage = async (request) => {
    const events = await getChannelActiveThreadEvents(request);
    return parseChannelActiveThreadsResponse(events, channelId, request.cursor);
  },
}: FetchPageInput): Promise<ActiveThreadsPage> {
  throwIfAborted(signal);
  const page = await requestPage({
    channelId,
    activeSince,
    includedRootIds,
    cursor,
    limitRows: ACTIVE_THREAD_PAGE_SIZE,
  });
  throwIfAborted(signal);
  return page;
}
