import { invokeTauri } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";
import type { ActiveThreadCursor } from "@/features/sidebar/lib/channelActiveThreadsResponse";

export type ChannelActiveThreadsRequest = {
  channelId: string;
  activeSince: number | null;
  includedRootIds: string[];
  cursor?: ActiveThreadCursor | null;
  limitRows?: number;
};

/** Fetch one authoritative active-thread page for a channel. */
export function getChannelActiveThreadEvents({
  channelId,
  activeSince,
  includedRootIds,
  cursor = null,
  limitRows = 50,
}: ChannelActiveThreadsRequest): Promise<RelayEvent[]> {
  return invokeTauri<RelayEvent[]>("get_active_threads", {
    channelId,
    activeSince,
    limitRows,
    cursor,
    includedRootIds,
  });
}
