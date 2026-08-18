import { MessageSquareText } from "lucide-react";

import type { ProjectedSidebarThread } from "@/features/sidebar/lib/threadSidebarProjection";
import type { ThreadSidebarInactivity } from "@/features/sidebar/lib/threadSidebarPreferencesStorage";
import { cn } from "@/shared/lib/cn";

export const THREAD_INACTIVITY_OPTIONS: Array<{
  value: ThreadSidebarInactivity;
  label: string;
}> = [
  { value: "1d", label: "1 day" },
  { value: "3d", label: "3 days" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "never", label: "Never" },
];

export function SidebarThreadRow({
  thread,
  selected,
  unread,
  onNavigate,
}: {
  thread: ProjectedSidebarThread;
  selected: boolean;
  unread: boolean;
  onNavigate: () => void;
}) {
  return (
    <button
      aria-current={selected ? "page" : undefined}
      className={cn(
        "flex h-7 w-full min-w-0 items-center gap-2 rounded-md py-1 pl-7 pr-2 text-left text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        selected && "bg-sidebar-active text-sidebar-active-foreground",
      )}
      data-active={selected}
      data-unread={unread}
      data-testid={`sidebar-thread-${thread.rootId}`}
      onClick={onNavigate}
      onContextMenu={(event) => event.preventDefault()}
      title={thread.label}
      type="button"
    >
      <MessageSquareText aria-hidden="true" className="size-3.5 shrink-0" />
      <span className={cn("min-w-0 flex-1 truncate", unread && "font-bold")}>
        {thread.label}
      </span>
      {unread ? (
        <span
          aria-label="Unread replies"
          className={cn(
            "size-2 shrink-0 rounded-full bg-primary",
            selected && "bg-sidebar-active-foreground",
          )}
          data-testid="sidebar-thread-unread"
          role="img"
          title="Unread replies"
        />
      ) : null}
    </button>
  );
}
