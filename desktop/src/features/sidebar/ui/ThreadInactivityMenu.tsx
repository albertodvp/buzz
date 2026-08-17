import { Clock3 } from "lucide-react";

import { useChannelThreadSidebarPreference } from "@/features/sidebar/lib/useChannelSidebarThreads";
import { ContextMenuIconSlot } from "@/features/sidebar/ui/sidebarMenuHelpers";
import { THREAD_INACTIVITY_OPTIONS } from "./SidebarThreadRow";
import {
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/shared/ui/context-menu";

export function ThreadInactivityMenu({ channelId }: { channelId: string }) {
  const { preference, setInactivity } =
    useChannelThreadSidebarPreference(channelId);
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <ContextMenuIconSlot>
          <Clock3 className="size-4" />
        </ContextMenuIconSlot>
        <span>Hide threads after inactivity</span>
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuRadioGroup
          onValueChange={(value) =>
            setInactivity(value as typeof preference.inactivity)
          }
          value={preference.inactivity}
        >
          {THREAD_INACTIVITY_OPTIONS.map((option) => (
            <ContextMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </ContextMenuRadioItem>
          ))}
        </ContextMenuRadioGroup>
        <p className="max-w-56 px-2 py-1 text-xs text-muted-foreground">
          This setting affects only your sidebar.
        </p>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
