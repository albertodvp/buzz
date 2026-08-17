import { normalizeRelayUrl } from "@/shared/lib/normalizeRelayUrl";
import { setLocalStorageItemWithRecovery } from "@/shared/lib/localStorageQuota";

export type ThreadSidebarInactivity =
  | "1d"
  | "3d"
  | "7d"
  | "30d"
  | "never"
  | "pinned-only";

export type ThreadSidebarScope = {
  relayUrl: string;
  communityId: string;
  pubkey: string;
};

type PinPreference = { pinned: boolean; updatedAt: number };
type ChannelPreference = {
  inactivity: ThreadSidebarInactivity;
  updatedAt: number;
  pins: Record<string, PinPreference>;
};
export type ThreadSidebarPreferences = {
  version: 1;
  channels: Record<string, ChannelPreference>;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export const DEFAULT_THREAD_INACTIVITY: ThreadSidebarInactivity = "3d";
export const THREAD_SIDEBAR_PREFERENCES_EVENT =
  "buzz:thread-sidebar-preferences";
const PREFIX = "buzz-thread-sidebar-preferences.v1";
const MAX_CHANNELS = 128;
const MAX_PINS_PER_CHANNEL = 256;
const MAX_ID_LENGTH = 256;
const CHOICES = new Set<ThreadSidebarInactivity>([
  "1d",
  "3d",
  "7d",
  "30d",
  "never",
  "pinned-only",
]);

export function threadSidebarPreferencesKey(scope: ThreadSidebarScope): string {
  return `${PREFIX}:${normalizeRelayUrl(scope.relayUrl)}:${scope.communityId.toLowerCase()}:${scope.pubkey.toLowerCase()}`;
}

function finiteTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function parseThreadSidebarPreferences(
  value: unknown,
): ThreadSidebarPreferences | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (
    source.version !== 1 ||
    !source.channels ||
    typeof source.channels !== "object"
  ) {
    return null;
  }
  const channels: Record<string, ChannelPreference> = {};
  const channelEntries = Object.entries(
    source.channels as Record<string, unknown>,
  );
  if (channelEntries.length > MAX_CHANNELS) return null;
  for (const [channelId, rawChannel] of channelEntries) {
    if (
      !channelId ||
      channelId.length > MAX_ID_LENGTH ||
      !rawChannel ||
      typeof rawChannel !== "object"
    )
      return null;
    const channel = rawChannel as Record<string, unknown>;
    if (
      !CHOICES.has(channel.inactivity as ThreadSidebarInactivity) ||
      !finiteTimestamp(channel.updatedAt) ||
      !channel.pins ||
      typeof channel.pins !== "object"
    )
      return null;
    const pinEntries = Object.entries(channel.pins as Record<string, unknown>);
    if (pinEntries.length > MAX_PINS_PER_CHANNEL) return null;
    const pins: Record<string, PinPreference> = {};
    for (const [rootId, rawPin] of pinEntries) {
      if (
        !rootId ||
        rootId.length > MAX_ID_LENGTH ||
        !rawPin ||
        typeof rawPin !== "object"
      )
        return null;
      const pin = rawPin as Record<string, unknown>;
      if (typeof pin.pinned !== "boolean" || !finiteTimestamp(pin.updatedAt))
        return null;
      pins[rootId] = { pinned: pin.pinned, updatedAt: pin.updatedAt };
    }
    channels[channelId] = {
      inactivity: channel.inactivity as ThreadSidebarInactivity,
      updatedAt: channel.updatedAt as number,
      pins,
    };
  }
  return { version: 1, channels };
}

const EMPTY: ThreadSidebarPreferences = Object.freeze({
  version: 1,
  channels: {},
});

export function readThreadSidebarPreferences(
  scope: ThreadSidebarScope,
  storage: StorageLike = window.localStorage,
): ThreadSidebarPreferences {
  try {
    const raw = storage.getItem(threadSidebarPreferencesKey(scope));
    if (!raw) return EMPTY;
    return parseThreadSidebarPreferences(JSON.parse(raw)) ?? EMPTY;
  } catch {
    return EMPTY;
  }
}

function write(
  scope: ThreadSidebarScope,
  preferences: ThreadSidebarPreferences,
  storage: StorageLike,
): boolean {
  const key = threadSidebarPreferencesKey(scope);
  const serialized = JSON.stringify(preferences);
  let succeeded = false;
  if (typeof window !== "undefined" && storage === window.localStorage) {
    succeeded = setLocalStorageItemWithRecovery(key, serialized);
  } else {
    try {
      storage.setItem(key, serialized);
      succeeded = true;
    } catch {
      succeeded = false;
    }
  }
  if (succeeded && typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(THREAD_SIDEBAR_PREFERENCES_EVENT, { detail: { key } }),
    );
  }
  return succeeded;
}

function oldestFirst<T extends { updatedAt: number }>(
  [leftKey, left]: readonly [string, T],
  [rightKey, right]: readonly [string, T],
): number {
  return left.updatedAt - right.updatedAt || leftKey.localeCompare(rightKey);
}

/** Keep every persisted payload readable by this module's strict parser. */
function boundedPreferences(
  preferences: ThreadSidebarPreferences,
): ThreadSidebarPreferences {
  const boundedChannels = Object.fromEntries(
    Object.entries(preferences.channels)
      .map(([channelId, channel]) => {
        // False entries are device-local tombstones with no merge consumer.
        const pins = Object.fromEntries(
          Object.entries(channel.pins)
            .filter(([, pin]) => pin.pinned)
            .sort(oldestFirst)
            .slice(-MAX_PINS_PER_CHANNEL),
        );
        return [channelId, { ...channel, pins }] as const;
      })
      .sort(oldestFirst)
      .slice(-MAX_CHANNELS),
  );
  return { version: 1, channels: boundedChannels };
}

function withChannel(
  preferences: ThreadSidebarPreferences,
  channelId: string,
  now: number,
): ChannelPreference {
  return (
    preferences.channels[channelId] ?? {
      inactivity: DEFAULT_THREAD_INACTIVITY,
      updatedAt: now,
      pins: {},
    }
  );
}

export function updateThreadPin(
  scope: ThreadSidebarScope,
  channelId: string,
  rootId: string,
  pinned: boolean,
  storage: StorageLike = window.localStorage,
  now = Date.now(),
): boolean {
  if (
    !channelId ||
    channelId.length > MAX_ID_LENGTH ||
    !rootId ||
    rootId.length > MAX_ID_LENGTH ||
    !finiteTimestamp(now)
  )
    return false;
  const current = readThreadSidebarPreferences(scope, storage);
  const channel = withChannel(current, channelId, now);
  const pins = { ...channel.pins };
  if (pinned) pins[rootId] = { pinned: true, updatedAt: now };
  else delete pins[rootId];
  const next: ThreadSidebarPreferences = {
    version: 1,
    channels: {
      ...current.channels,
      [channelId]: {
        ...channel,
        updatedAt: now,
        pins,
      },
    },
  };
  return write(scope, boundedPreferences(next), storage);
}

export function updateChannelInactivity(
  scope: ThreadSidebarScope,
  channelId: string,
  inactivity: ThreadSidebarInactivity,
  storage: StorageLike = window.localStorage,
  now = Date.now(),
): boolean {
  if (
    !CHOICES.has(inactivity) ||
    !channelId ||
    channelId.length > MAX_ID_LENGTH ||
    !finiteTimestamp(now)
  )
    return false;
  const current = readThreadSidebarPreferences(scope, storage);
  const channel = withChannel(current, channelId, now);
  return write(
    scope,
    boundedPreferences({
      version: 1,
      channels: {
        ...current.channels,
        [channelId]: { ...channel, inactivity, updatedAt: now },
      },
    }),
    storage,
  );
}

export function channelThreadSidebarPreference(
  preferences: ThreadSidebarPreferences,
  channelId: string,
): ChannelPreference {
  return withChannel(preferences, channelId, 0);
}
