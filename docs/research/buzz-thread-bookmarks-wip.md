# Thread bookmarks: WIP intent

## Scope

This branch follows recent-thread navigation with a private, device-local way to
keep selected thread roots in the channel sidebar regardless of age. It is WIP
because persistence should be agreed independently from recent discovery.

## User contract

- **Bookmark thread** is available from a root message and its sidebar row.
- **Remove bookmark** reverses only the personal shortcut.
- A filled bookmark icon appears in the sidebar row and beside the root's normal
  timeline reply summary.
- Bookmarked roots remain visible outside the inactivity window; they retain
  latest-activity ordering and do not jump to a separate section.
- **Only bookmarks** is an additional inactivity-menu choice.
- The action is a toggle: applying it twice returns to the original state.
- Desktop and Android expose equivalent state and actions; Android uses a
  practical touch target rather than hiding the action behind a tiny icon.

## Local and remote semantics

The bookmark and inactivity window are local preferences, scoped by relay,
community, identity, and channel. They are not published, shared with channel
members, or interpreted by the relay. Messages, reply topology, authorization,
and latest activity remain remote authoritative state.

To resolve an old saved root, the client may include its event ID in the generic
active-thread query. The relay permission-checks and returns canonical events but
does not store or infer bookmark state. This leaks the requested ID to the relay,
as any server-side fetch does; it does not create a shared record.

## Why “bookmark”, not “pin”

“Pin” commonly means a shared channel-level curation action. Slack's channel
bookmarks and pinned messages are visible to everyone with channel access, and
Discord pins are likewise shared channel artifacts. This feature instead means
“keep this for me”. Calling it **bookmark** preserves the familiar distinction
and leaves **pin** available for a future moderator/shared feature.

Nostr vocabulary points the same way: NIP-51 models bookmark sets separately
from public/profile pinning. Device-local storage is only the first persistence
choice, not a claim that bookmarks must remain device-local forever.

## Fit with Buzz, and tension

The design is edge-owned and does not invent a server endpoint or shared event
for a private presentation preference. That fits Buzz's Nostr-first, sovereign
model better than silently giving a local click social meaning.

The tension is portability: a Buzz identity and its conversations survive a
device change, while these bookmarks currently do not. Before merging this
follow-up, choose deliberately between device-local state and encrypted
cross-device Nostr state; do not let the current implementation decide the
product contract by accident.

## Existing GitHub overlap

- [Issue #4266](https://github.com/block/buzz/issues/4266) proposes personal
  thread pins in a separate cross-channel rail and says implementation is in
  progress. The storage/action overlap is direct; placement and automatic recent
  discovery differ.
- [PR #3712](https://github.com/block/buzz/pull/3712) proposes private
  cross-device message bookmarks using encrypted NIP-78 data and a Saved view.
  It is the closest persistence overlap and should inform the decision above.
- [PR #3459](https://github.com/block/buzz/pull/3459) explores pinned/recent
  channels and side chats, but targets a different desktop surface and model.

## Not included

- shared or administrator-managed pins;
- a global Saved view or cross-channel bookmark rail;
- bookmark notifications;
- changing thread reply depth or rendering nested sidebar trees.
