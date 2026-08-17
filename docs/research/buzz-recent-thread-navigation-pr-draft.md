# PR draft: recent thread navigation

## Summary

Show recently active thread roots beneath their channel on desktop and mobile,
with a local inactivity window, unread state, and canonical focus navigation.

## Why

Replies can continue after their root scrolls out of the channel timeline. The
sidebar provides a small, channel-scoped rediscovery surface without changing
message identity, reply semantics, or publishing new state.

## Behavior

- Relay/database query returns permission-checked roots ordered by aggregate
  descendant activity, using a bounded cutoff and composite cursor.
- Desktop and mobile show compact root rows and existing unread semantics.
- Channel actions expose 1/3/7/30-day and Never visibility choices.
- A row opens the canonical thread in focus mode; pressing it again closes it.
- Desktop queries only the selected channel; mobile batches known channel
  filters. A bounded cross-channel startup query is intentionally follow-up work.

## Validation

- Database and relay tests cover root eligibility, descendant activity, bounds,
  ordering, pagination, and authorization.
- Desktop unit/E2E tests cover response parsing, local preferences, filtering,
  unread state, menu spacing, selected-row paint, focus navigation, and close-on-
  second-press behavior.
- Flutter widget/unit tests cover query shape, parsing, preference persistence,
  projection, unread state, row density, and tapping.

## Not included

Bookmarks are intentionally split into a follow-up WIP branch. They introduce a
separate persistence and product-semantics decision and are not required for
recent-thread discovery.
