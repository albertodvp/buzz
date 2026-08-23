import * as React from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearch } from "@tanstack/react-router";

import { useAppShell } from "@/app/AppShellContext";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { requestFocusedThreadClose } from "@/features/channels/focusedThreadCloseRequest";
import { setThreadViewMode } from "@/features/channels/lib/threadViewModePreference";
import { relayClient } from "@/shared/api/relayClient";
import { useNow } from "@/shared/lib/useNow";
import {
  activeThreadsQueryKey,
  fetchActiveThreadsPage,
} from "./channelActiveThreadsQuery";
import {
  createBoundedQueryScheduler,
  type BoundedQueryScheduler,
} from "./boundedQueryScheduler";
import type { ActiveThreadCursor } from "./channelActiveThreadsResponse";
import { shouldQuerySidebarChannel } from "./sidebarThreadCandidates";
import {
  isThreadSidebarUnread,
  projectThreadSidebarRows,
  threadSidebarCutoff,
} from "./threadSidebarProjection";
import {
  channelThreadSidebarPreference,
  readThreadSidebarPreferences,
  THREAD_SIDEBAR_PREFERENCES_EVENT,
  threadSidebarPreferencesKey,
  updateChannelInactivity,
  type ThreadSidebarInactivity,
  type ThreadSidebarPreferences,
  type ThreadSidebarScope,
} from "./threadSidebarPreferencesStorage";
import { SidebarThreadRow } from "../ui/SidebarThreadRow";

const MAX_CONCURRENT_THREAD_BOOTSTRAPS = 4;

type ThreadSidebarContextValue = {
  candidateChannelIds: ReadonlySet<string>;
  scheduleQuery: BoundedQueryScheduler;
  scope: ThreadSidebarScope;
};

const ThreadSidebarContext =
  React.createContext<ThreadSidebarContextValue | null>(null);

export function ThreadSidebarProvider({
  scope,
  candidateChannelIds,
  children,
}: {
  scope: ThreadSidebarScope | null;
  candidateChannelIds: ReadonlySet<string>;
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const [scheduleQuery] = React.useState(() =>
    createBoundedQueryScheduler(MAX_CONCURRENT_THREAD_BOOTSTRAPS),
  );
  const contextValue = React.useMemo(
    () => (scope ? { candidateChannelIds, scheduleQuery, scope } : null),
    [candidateChannelIds, scheduleQuery, scope],
  );
  React.useEffect(
    () =>
      relayClient.subscribeToReconnects(() => {
        void queryClient.invalidateQueries({
          queryKey: ["sidebar-active-threads"],
        });
      }),
    [queryClient],
  );
  return (
    <ThreadSidebarContext.Provider value={contextValue}>
      {children}
    </ThreadSidebarContext.Provider>
  );
}

type Snapshot = {
  key: string;
  preferences: ThreadSidebarPreferences;
};

function useThreadSidebarPreferences(scope: ThreadSidebarScope | null) {
  const key = scope ? threadSidebarPreferencesKey(scope) : "";
  const [snapshot, setSnapshot] = React.useState<Snapshot>(() => ({
    key,
    preferences: scope
      ? readThreadSidebarPreferences(scope)
      : { version: 1, channels: {} },
  }));
  let current = snapshot;
  if (snapshot.key !== key) {
    current = {
      key,
      preferences: scope
        ? readThreadSidebarPreferences(scope)
        : { version: 1, channels: {} },
    };
    setSnapshot(current);
  }

  React.useEffect(() => {
    if (!scope) return;
    const refresh = () =>
      setSnapshot({ key, preferences: readThreadSidebarPreferences(scope) });
    const onCustom = (event: Event) => {
      if ((event as CustomEvent<{ key?: string }>).detail?.key === key)
        refresh();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) refresh();
    };
    window.addEventListener(THREAD_SIDEBAR_PREFERENCES_EVENT, onCustom);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(THREAD_SIDEBAR_PREFERENCES_EVENT, onCustom);
      window.removeEventListener("storage", onStorage);
    };
  }, [key, scope]);

  return current.preferences;
}

export function useChannelThreadSidebarPreference(channelId: string) {
  const context = React.useContext(ThreadSidebarContext);
  const scope = context?.scope ?? null;
  const preferences = useThreadSidebarPreferences(scope);
  const preference = channelThreadSidebarPreference(preferences, channelId);
  const setInactivity = React.useCallback(
    (value: ThreadSidebarInactivity) => {
      if (scope) updateChannelInactivity(scope, channelId, value);
    },
    [channelId, scope],
  );
  return { scope, preference, setInactivity };
}

export function SidebarChannelThreads({ channelId }: { channelId: string }) {
  const queryClient = useQueryClient();
  const {
    getThreadReadAt,
    isReadStateReady,
    markThreadRead,
    readStateVersion,
    unreadThreadRootIds,
  } = useAppShell();
  const context = React.useContext(ThreadSidebarContext);
  const { scope, preference } = useChannelThreadSidebarPreference(channelId);
  const nowMilliseconds = useNow(60_000);
  const nowSeconds = Math.floor(nowMilliseconds / 1_000);
  const params = useParams({ strict: false }) as { channelId?: string };
  const isSelectedChannel = params.channelId === channelId;
  const enabled =
    context !== null &&
    shouldQuerySidebarChannel(
      params.channelId,
      channelId,
      context.candidateChannelIds,
    );
  const query = useInfiniteQuery({
    queryKey: scope
      ? activeThreadsQueryKey(scope, channelId, preference.inactivity)
      : ["sidebar-active-threads", "disabled", channelId],
    queryFn: ({ signal, pageParam }) => {
      const requestedAt = Math.floor(Date.now() / 1_000);
      if (!context) throw new Error("Thread sidebar scope is unavailable.");
      return context.scheduleQuery(
        () =>
          fetchActiveThreadsPage({
            channelId,
            activeSince: threadSidebarCutoff(
              preference.inactivity,
              requestedAt,
            ),
            cursor: pageParam,
            signal,
          }),
        { priority: isSelectedChannel ? 1 : 0, signal },
      );
    },
    initialPageParam: null as ActiveThreadCursor | null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
    staleTime: 30_000,
  });
  const authoritativeRows = React.useMemo(
    () => query.data?.pages.flatMap((page) => page.rows) ?? [],
    [query.data],
  );
  const rows = React.useMemo(
    () =>
      projectThreadSidebarRows(
        authoritativeRows,
        preference,
        nowSeconds,
      ).filter((thread) => thread.channelId === channelId),
    [authoritativeRows, channelId, nowSeconds, preference],
  );
  React.useEffect(() => {
    if (!enabled || !scope || preference.inactivity === "never") return;
    const windowCutoff = threadSidebarCutoff(preference.inactivity, nowSeconds);
    if (windowCutoff === null) return;
    const nextExpiry = authoritativeRows
      .map((row) => row.latestActivityAt - windowCutoff + 1)
      .filter((seconds) => seconds > 0)
      .sort((left, right) => left - right)[0];
    if (nextExpiry === undefined) return;
    const timer = window.setTimeout(
      () => {
        void queryClient.invalidateQueries({
          queryKey: activeThreadsQueryKey(
            scope,
            channelId,
            preference.inactivity,
          ),
        });
      },
      Math.min(nextExpiry * 1_000, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [
    authoritativeRows,
    channelId,
    enabled,
    nowSeconds,
    preference.inactivity,
    queryClient.invalidateQueries,
    scope,
  ]);
  const search = useSearch({ strict: false }) as {
    threadRootId?: string;
    thread?: string;
  };
  const selectedRootId = search.threadRootId ?? search.thread ?? null;
  const { goChannel } = useAppNavigation();
  const selectedThread = rows.find(
    (thread) => thread.rootId === selectedRootId,
  );
  const selectedLatestReplyAt = selectedThread?.latestReplyAt ?? null;
  React.useEffect(() => {
    void readStateVersion;
    if (
      !selectedThread ||
      !isReadStateReady ||
      selectedLatestReplyAt === null ||
      !unreadThreadRootIds.has(selectedThread.rootId) ||
      !isThreadSidebarUnread(
        selectedLatestReplyAt,
        getThreadReadAt(selectedThread.rootId, channelId),
      )
    ) {
      return;
    }
    markThreadRead(selectedThread.rootId, selectedLatestReplyAt);
  }, [
    channelId,
    getThreadReadAt,
    isReadStateReady,
    markThreadRead,
    readStateVersion,
    selectedLatestReplyAt,
    selectedThread,
    unreadThreadRootIds,
  ]);

  if (rows.length === 0 && !query.hasNextPage) return null;
  return (
    <ul
      aria-label="Channel threads"
      className="list-none"
      data-testid={`sidebar-threads-${channelId}`}
    >
      {rows.map((thread) => (
        <li key={thread.rootId}>
          <SidebarThreadRow
            thread={thread}
            selected={selectedRootId === thread.rootId}
            unread={
              isReadStateReady &&
              selectedRootId !== thread.rootId &&
              unreadThreadRootIds.has(thread.rootId) &&
              isThreadSidebarUnread(
                thread.latestReplyAt,
                getThreadReadAt(thread.rootId, channelId),
              )
            }
            onNavigate={() => {
              if (selectedRootId === thread.rootId) {
                requestFocusedThreadClose();
                return;
              }
              if (thread.latestReplyAt !== null) {
                markThreadRead(thread.rootId, thread.latestReplyAt);
              }
              setThreadViewMode("focus");
              void goChannel(channelId, {
                messageId: thread.rootId,
                threadRootId: thread.rootId,
              });
            }}
          />
        </li>
      ))}
      {query.hasNextPage ? (
        <li className="px-2 py-1">
          <button
            className="text-xs text-sidebar-foreground/70 hover:text-sidebar-foreground"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
            type="button"
          >
            {query.isFetchingNextPage ? "Loading…" : "Load more threads"}
          </button>
        </li>
      ) : null}
    </ul>
  );
}
