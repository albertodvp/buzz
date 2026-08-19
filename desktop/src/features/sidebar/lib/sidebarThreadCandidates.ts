export const MAX_RECENT_THREAD_CHANNEL_CANDIDATES = 8;

type ChannelActivity = {
  channelId: string;
  createdAt: number;
};

/** Build a fixed-size startup set from the existing local activity read model. */
export function recentThreadCandidateChannelIds(
  activity: readonly ChannelActivity[],
  limit = MAX_RECENT_THREAD_CHANNEL_CANDIDATES,
): ReadonlySet<string> {
  if (limit <= 0) return new Set();
  const latestByChannel = new Map<string, number>();
  for (const item of activity) {
    const previous = latestByChannel.get(item.channelId);
    if (previous === undefined || item.createdAt > previous) {
      latestByChannel.set(item.channelId, item.createdAt);
    }
  }
  return new Set(
    [...latestByChannel]
      .sort(
        ([leftId, leftAt], [rightId, rightAt]) =>
          rightAt - leftAt || leftId.localeCompare(rightId),
      )
      .slice(0, limit)
      .map(([channelId]) => channelId),
  );
}

export function shouldQuerySidebarChannel(
  selectedChannelId: string | undefined,
  channelId: string,
  candidateChannelIds: ReadonlySet<string>,
): boolean {
  return selectedChannelId === channelId || candidateChannelIds.has(channelId);
}
