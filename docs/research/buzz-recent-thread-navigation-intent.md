# Recent thread navigation intent

## Goal

Make ongoing channel conversations discoverable without introducing a second
thread model. Each channel may show a compact list of recently active thread
roots directly beneath its normal sidebar row on desktop and mobile.

## User contract

- A row represents a canonical root message that has at least one descendant.
- Rows are ordered by latest activity across the complete reply tree. Buzz may
  support replies deeper than Slack or Discord; the sidebar remains a flat list
  of roots and does not attempt to render an arbitrarily deep tree.
- The channel menu controls the local visibility window: 1, 3, 7, or 30 days,
  or Never. The default is 3 days.
- Unread is derived from the latest reply and the existing effective read
  frontier. Opening a row marks that thread read through the known reply.
- Selecting a row opens the canonical thread in focus mode. Selecting the same
  row again closes it.
- Rows use the existing message-thread icon and sidebar selection treatment.
  Mobile rows retain a practical touch target without changing channel density.

## Local and shared state

The relay owns messages, reply relationships, permission checks, and the
authoritative latest-activity aggregate. The inactivity preference and current
read/navigation presentation are client state. The client sends the cutoff as
a query bound; the relay does not know or store the user's chosen window.

The query returns roots only, while activity includes all descendants. This is
intentional: two visible nesting levels would imply a partial tree whose meaning
changes as deeper replies arrive. A separate follow-up can explore contextual
paths or bounded previews without changing this root-navigation contract.

## Product fit and tensions

This follows Buzz's Nostr-first model: the existing generic query surface carries
an extension rather than adding a feature-specific HTTP endpoint, and returned
events remain canonical Nostr events. It also keeps shared conversation truth on
the relay and presentation preferences at the edge.

The deliberate tension is discovery at fresh startup. Desktop currently queries
the selected channel only, avoiding an unbounded request fan-out across every
community channel; an unvisited channel's recent rows appear after selection.
Mobile can batch its known channel filters. Cross-channel startup discovery
should be addressed separately with a bounded/batched protocol rather than
quietly issuing one desktop query per channel.

## Out of scope

- personal bookmarks or saved threads;
- shared/admin pins;
- cross-device preference synchronization;
- nested sidebar trees;
- a cross-channel thread inbox.
