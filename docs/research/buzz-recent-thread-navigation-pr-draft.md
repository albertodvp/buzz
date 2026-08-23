# PR draft: recent thread navigation

## Summary

Show recently active thread roots beneath their channel on desktop and mobile,
with a local inactivity window, unread state, and canonical focus navigation.

## Why

Replies can continue after their root scrolls out of the channel timeline. The
sidebar provides a small, channel-scoped rediscovery surface without changing
message identity, reply semantics, or publishing new state.

## Why this requires relay and database work

Neither client has a complete thread index: channel timelines are bounded, a
root may already have scrolled out, and activity can come from any descendant.
Computing the list in Desktop or Mobile would therefore produce incomplete and
client-dependent ordering.

The database is the only layer with the complete `thread_metadata` ancestry,
soft-deletion state, and community/channel boundary needed to aggregate this
correctly before applying the page limit. The relay exposes that aggregate
through the existing generic Nostr query bridge; this change adds no dedicated
HTTP endpoint and no migration. Clients continue to own only the local
inactivity preference and presentation state.

## Behavior

- Relay/database query returns permission-checked roots ordered by aggregate
  descendant activity, using a bounded cutoff and composite cursor.
- Desktop and mobile show compact root rows and existing unread semantics.
- Channel actions expose 1/3/7/30-day and Never visibility choices.
- A row opens the canonical thread in focus mode; pressing it again closes it.
- Desktop queries the selected channel plus a fixed-size candidate set derived
  from its local activity read model. Mobile batches known-channel first pages,
  supports per-channel cursors, and refreshes from one live subscription.

## Validation

- A required Postgres/Redis CI step explicitly runs the infrastructure-backed
  `#[ignore]` database and relay tests covering
  root-kind pushdown, descendant activity, deletion, cutoff, deterministic
  pagination, bounds, participant summaries, and cross-channel authorization.
- Desktop unit/E2E tests cover response parsing, local preferences, filtering,
  unread state, menu spacing, selected-row paint, focus navigation, and close-on-
  second-press behavior.
- Flutter widget/unit tests cover query shape, parsing, preference persistence,
  projection, unread state, row density, and tapping.

## Not included

Bookmarks are intentionally split into a follow-up WIP branch. They introduce a
separate persistence and product-semantics decision and are not required for
recent-thread discovery.
