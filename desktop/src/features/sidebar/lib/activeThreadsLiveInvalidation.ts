import type { QueryFilters } from "@tanstack/react-query";

import { getThreadReference } from "@/features/messages/lib/threading";
import {
  CHANNEL_TIMELINE_CONTENT_KINDS,
  KIND_CHANNEL_THREAD_SUMMARY,
  KIND_DELETION,
  KIND_NIP29_DELETE_EVENT,
} from "@/shared/constants/kinds";

const ACTIVE_THREADS_QUERY_PREFIX = ["sidebar-active-threads"] as const;
const TIMELINE_KINDS = new Set<number>(CHANNEL_TIMELINE_CONTENT_KINDS);
const DELETION_KINDS = new Set<number>([
  KIND_DELETION,
  KIND_NIP29_DELETE_EVENT,
]);

type LiveThreadEvent = {
  kind: number;
  tags: string[][];
};

/**
 * Build a narrow invalidation for authoritative active-thread data.
 * Only the mounted selected-channel query can refetch; other channel caches
 * remain fenced by the channel predicate and no sidebar fan-out is introduced.
 */
export function activeThreadsLiveInvalidationFilters(
  channelId: string,
  event: LiveThreadEvent,
): QueryFilters | null {
  const isSummary = event.kind === KIND_CHANNEL_THREAD_SUMMARY;
  const isDeletion = DELETION_KINDS.has(event.kind);
  const isReply =
    TIMELINE_KINDS.has(event.kind) &&
    getThreadReference(event.tags)?.parentId != null;
  if (!isSummary && !isDeletion && !isReply) return null;

  return {
    queryKey: ACTIVE_THREADS_QUERY_PREFIX,
    predicate: (query) => query.queryKey[4] === channelId,
  };
}
