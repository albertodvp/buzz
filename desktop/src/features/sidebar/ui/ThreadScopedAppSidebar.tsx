import * as React from "react";

import { useAppShell } from "@/app/AppShellContext";
import { recentThreadCandidateChannelIds } from "@/features/sidebar/lib/sidebarThreadCandidates";
import { ThreadSidebarProvider } from "@/features/sidebar/lib/useChannelSidebarThreads";
import { AppSidebar } from "@/features/sidebar/ui/AppSidebar";

type ThreadScopedAppSidebarProps = React.ComponentProps<typeof AppSidebar>;
type ThreadSidebarScopeProviderProps = Pick<
  ThreadScopedAppSidebarProps,
  "activeCommunity" | "channels" | "currentPubkey"
> & { children: React.ReactNode };

export function ThreadSidebarScopeProvider({
  activeCommunity,
  channels,
  currentPubkey,
  children,
}: ThreadSidebarScopeProviderProps) {
  const { threadActivityItems } = useAppShell();
  const candidateChannelIds = React.useMemo(
    () =>
      recentThreadCandidateChannelIds([
        ...threadActivityItems,
        ...channels.flatMap((channel) => {
          if (channel.channelType !== "stream" || !channel.lastMessageAt)
            return [];
          const createdAt = Date.parse(channel.lastMessageAt) / 1_000;
          return Number.isFinite(createdAt)
            ? [{ channelId: channel.id, createdAt }]
            : [];
        }),
      ]),
    [channels, threadActivityItems],
  );
  const scope =
    activeCommunity && currentPubkey
      ? {
          relayUrl: activeCommunity.relayUrl,
          communityId: activeCommunity.id,
          pubkey: currentPubkey,
        }
      : null;

  return (
    <ThreadSidebarProvider
      candidateChannelIds={candidateChannelIds}
      scope={scope}
    >
      {children}
    </ThreadSidebarProvider>
  );
}

/** Sidebar adapter kept separate from the scope shared with the channel surface. */
export function ThreadScopedAppSidebar(props: ThreadScopedAppSidebarProps) {
  return <AppSidebar {...props} />;
}
