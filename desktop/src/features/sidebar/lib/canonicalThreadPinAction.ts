import { getThreadReference } from "@/features/messages/lib/threading";

type ThreadActionMessage = {
  id: string;
  tags?: string[][];
};

export function resolveCanonicalThreadRootId(
  message: ThreadActionMessage,
): string {
  return getThreadReference(message.tags ?? []).rootId ?? message.id;
}

export function toggleCanonicalThreadPin({
  channelId,
  message,
  pinned,
  writeLocalPin,
}: {
  channelId: string;
  message: ThreadActionMessage;
  pinned: boolean;
  writeLocalPin: (
    channelId: string,
    rootId: string,
    pinned: boolean,
  ) => boolean;
}): boolean {
  return writeLocalPin(
    channelId,
    resolveCanonicalThreadRootId(message),
    pinned,
  );
}
