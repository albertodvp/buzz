import type React from "react";

import { ThreadSidebarProvider } from "@/features/sidebar/lib/useChannelSidebarThreads";
import { AppSidebar } from "@/features/sidebar/ui/AppSidebar";

type ThreadScopedAppSidebarProps = React.ComponentProps<typeof AppSidebar>;
type ThreadSidebarScopeProviderProps = Pick<
  ThreadScopedAppSidebarProps,
  "activeCommunity" | "currentPubkey"
> & { children: React.ReactNode };

export function ThreadSidebarScopeProvider({
  activeCommunity,
  currentPubkey,
  children,
}: ThreadSidebarScopeProviderProps) {
  const scope =
    activeCommunity && currentPubkey
      ? {
          relayUrl: activeCommunity.relayUrl,
          communityId: activeCommunity.id,
          pubkey: currentPubkey,
        }
      : null;

  return (
    <ThreadSidebarProvider scope={scope}>{children}</ThreadSidebarProvider>
  );
}

/** Sidebar adapter kept separate from the scope shared with the channel surface. */
export function ThreadScopedAppSidebar(props: ThreadScopedAppSidebarProps) {
  return <AppSidebar {...props} />;
}
