import * as React from "react";

import { useThreadActivityFeedItems } from "@/app/useThreadActivityFeedItems";
import {
  maxReadAt,
  msgContextKey,
} from "@/features/channels/readState/readStateFormat";
import type { ThreadActivityItem } from "@/features/channels/useUnreadChannels";
import {
  getThreadReference,
  isThreadReply,
} from "@/features/messages/lib/threading";
import type { Channel, FeedItem, HomeFeed } from "@/shared/api/types";

type ReadTimestamp = (contextKey: string) => number | null;
type MarkChannelRead = (
  contextKey: string,
  readAt: string | null | undefined,
  options?: { topLevelOnly?: boolean },
) => void;

type UseChannelActivityProjectionOptions = {
  channels: Channel[];
  feed: HomeFeed | undefined;
  unreadFeedItemIds: ReadonlySet<string>;
  getChannelReadAt: ReadTimestamp;
  getOwnReadAt: ReadTimestamp;
  markChannelRead: MarkChannelRead;
  readStateVersion: number;
  threadActivityItems: ThreadActivityItem[];
  mutedRootIds: ReadonlySet<string>;
};

export function resolveChannelActivityFeedItemReadAt(
  item: Pick<FeedItem, "channelId" | "id">,
  getOwnReadAt: ReadTimestamp,
): number | null {
  return maxReadAt(
    getOwnReadAt(msgContextKey(item.id)),
    item.channelId ? getOwnReadAt(item.channelId) : null,
  );
}

export function collectUnreadThreadRootIds(
  items: Array<Pick<FeedItem, "tags">>,
): ReadonlySet<string> {
  const rootIds = new Set<string>();
  for (const item of items) {
    const rootId = getThreadReference(item.tags).rootId;
    if (rootId) rootIds.add(rootId);
  }
  return rootIds;
}

export function useChannelActivityProjection({
  channels,
  feed,
  unreadFeedItemIds,
  getChannelReadAt,
  getOwnReadAt,
  markChannelRead,
  readStateVersion,
  threadActivityItems,
  mutedRootIds,
}: UseChannelActivityProjectionOptions) {
  const getOwnThreadReadAt = React.useCallback(
    (rootId: string) => getOwnReadAt(`thread:${rootId}`),
    [getOwnReadAt],
  );
  const getThreadReadAt = React.useCallback(
    (rootId: string, channelId?: string | null) => {
      const threadReadAt = getOwnThreadReadAt(rootId);
      if (!channelId) return threadReadAt;

      const channelReadAt = getChannelReadAt(channelId);
      if (threadReadAt === null) return channelReadAt;
      if (channelReadAt === null) return threadReadAt;
      return Math.max(threadReadAt, channelReadAt);
    },
    [getChannelReadAt, getOwnThreadReadAt],
  );
  const markThreadRead = React.useCallback(
    (rootId: string, timestamp: number) =>
      markChannelRead(
        `thread:${rootId}`,
        new Date(timestamp * 1_000).toISOString(),
      ),
    [markChannelRead],
  );
  const getMessageReadAt = React.useCallback(
    (messageId: string) => getChannelReadAt(msgContextKey(messageId)),
    [getChannelReadAt],
  );
  const getChannelActivityItemReadAt = React.useCallback(
    (item: Pick<FeedItem, "channelId" | "id">) =>
      resolveChannelActivityFeedItemReadAt(item, getOwnReadAt),
    [getOwnReadAt],
  );
  const markMessageRead = React.useCallback(
    (messageId: string, timestamp: number) =>
      markChannelRead(
        msgContextKey(messageId),
        new Date(timestamp * 1_000).toISOString(),
      ),
    [markChannelRead],
  );
  const threadActivityFeedItems = useThreadActivityFeedItems(
    threadActivityItems,
    mutedRootIds,
    channels,
  );
  const locallyUnreadFeedItems = React.useMemo(() => {
    if (!feed || unreadFeedItemIds.size === 0) return [];
    return [
      ...feed.mentions,
      ...feed.needsAction,
      ...feed.activity,
      ...feed.agentActivity,
    ].filter((item) => unreadFeedItemIds.has(item.id));
  }, [feed, unreadFeedItemIds]);
  const unreadThreadFeedItems = React.useMemo(() => {
    void readStateVersion;
    const candidatesById = new Map<string, FeedItem>(
      threadActivityFeedItems.map((item) => [item.id, item]),
    );
    for (const item of locallyUnreadFeedItems)
      candidatesById.set(item.id, item);

    return [...candidatesById.values()].filter(
      (item) =>
        isThreadReply(item.tags) &&
        (unreadFeedItemIds.has(item.id) ||
          item.createdAt > (getChannelActivityItemReadAt(item) ?? 0)),
    );
  }, [
    getChannelActivityItemReadAt,
    locallyUnreadFeedItems,
    readStateVersion,
    threadActivityFeedItems,
    unreadFeedItemIds,
  ]);
  const unreadThreadChannelIds = React.useMemo(
    () =>
      new Set(
        unreadThreadFeedItems.flatMap((item) =>
          item.channelId ? [item.channelId] : [],
        ),
      ) as ReadonlySet<string>,
    [unreadThreadFeedItems],
  );
  const unreadThreadRootIds = React.useMemo(
    () => collectUnreadThreadRootIds(unreadThreadFeedItems),
    [unreadThreadFeedItems],
  );

  return {
    getOwnThreadReadAt,
    getThreadReadAt,
    markThreadRead,
    getMessageReadAt,
    getChannelActivityItemReadAt,
    markMessageRead,
    threadActivityFeedItems,
    locallyUnreadFeedItems,
    unreadThreadFeedItems,
    unreadThreadChannelIds,
    unreadThreadRootIds,
  };
}
