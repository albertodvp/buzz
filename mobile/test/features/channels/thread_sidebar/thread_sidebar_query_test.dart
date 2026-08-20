import 'dart:convert';

import 'package:buzz/features/channels/thread_sidebar/thread_sidebar_models.dart';
import 'package:buzz/features/channels/thread_sidebar/thread_sidebar_provider.dart';
import 'package:buzz/features/channels/thread_sidebar/thread_sidebar_query.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:flutter_test/flutter_test.dart';

const _channelId = 'general-id';

NostrEvent _event({
  required String id,
  required int kind,
  required String content,
  List<List<String>> tags = const [],
}) => NostrEvent(
  id: id,
  pubkey: 'author',
  createdAt: 100,
  kind: kind,
  tags: tags,
  content: content,
  sig: '',
);

void main() {
  test('separates query work budget from subscription channel budget', () {
    final values = List.generate(129, (index) => index);
    final queryChunks = threadSidebarQueryChunks(values);
    final subscriptionChunks = threadSidebarSubscriptionChunks(values);

    expect(queryChunks.map((chunk) => chunk.length), [
      ...List.filled(16, 8),
      1,
    ]);
    expect(subscriptionChunks.map((chunk) => chunk.length), [128, 1]);
    expect(queryChunks.expand((chunk) => chunk), orderedEquals(values));
    expect(subscriptionChunks.expand((chunk) => chunk), orderedEquals(values));
  });

  test('coalesces live refreshes by affected channel', () {
    final queue = ThreadSidebarLiveRefreshQueue();
    queue.add(
      _event(
        id: 'reply-a',
        kind: EventKind.streamMessage,
        content: 'reply',
        tags: const [
          ['h', 'channel-a'],
          ['e', 'root-a', '', 'reply'],
        ],
      ),
    );
    queue.add(
      _event(
        id: 'delete-b',
        kind: EventKind.deletion,
        content: '',
        tags: const [
          ['h', 'channel-b'],
        ],
      ),
    );

    expect(queue.take(), {'channel-a', 'channel-b'});
    expect(queue.take(), isEmpty);
  });

  test('builds the relay active-thread query with an activity cutoff', () {
    final filter = activeThreadsFilter(
      channelId: _channelId,
      preference: const ChannelThreadSidebarPreference(
        inactivity: ThreadSidebarInactivity.threeDays,
      ),
      nowSeconds: 1_000_000,
    );

    expect(filter.kinds, EventKind.channelTimelineContentKinds);
    expect(filter.tags, {
      '#h': [_channelId],
    });
    expect(filter.limit, 50);
    expect(filter.extensions, {
      'thread_roots_by_activity': true,
      'thread_active_since': 740800,
    });
  });

  test('parses roots and activity summaries from a batched relay response', () {
    final events = [
      _event(
        id: 'root-1',
        kind: EventKind.streamMessage,
        content: 'A recent thread',
        tags: const [
          ['h', _channelId],
        ],
      ),
      _event(
        id: 'summary-1',
        kind: EventKind.channelThreadSummary,
        content: jsonEncode({'latest_activity_at': 900, 'last_reply_at': 900}),
        tags: const [
          ['h', _channelId],
          ['e', 'root-1'],
        ],
      ),
      _event(
        id: 'bounds-1',
        kind: EventKind.channelWindowBounds,
        content: jsonEncode({'has_more': false}),
        tags: const [
          ['h', _channelId],
          ['d', '$_channelId:active-threads:head'],
        ],
      ),
    ];

    final page = parseActiveThreadBatch(events, const [
      _channelId,
    ])[_channelId]!;
    expect(page.rows, hasLength(1));
    expect(page.rows.single.root.id, 'root-1');
    expect(page.rows.single.latestActivityAt, 900);
    expect(page.rows.single.latestReplyAt, 900);
    expect(page.hasMore, isFalse);
    expect(page.nextCursor, isNull);
  });

  test('isolates a channel whose bounds frame is absent', () {
    final pages = parseActiveThreadBatch(const [], const [
      _channelId,
      'membership-raced-channel',
    ]);
    expect(pages[_channelId]?.rows, isEmpty);
    expect(pages['membership-raced-channel']?.hasMore, isFalse);
  });

  test('carries and validates the composite cursor for follow-up pages', () {
    final cursorId = List.filled(32, 'aa').join();
    final cursor = ActiveThreadCursor(latestActivityAt: 900, rootId: cursorId);
    final filter = activeThreadsFilter(
      channelId: _channelId,
      preference: const ChannelThreadSidebarPreference(),
      nowSeconds: 1_000_000,
      cursor: cursor,
    );
    expect(filter.extensions['thread_activity_cursor'], 900);
    expect(filter.extensions['thread_activity_cursor_id'], cursorId);

    final nextId = List.filled(32, 'bb').join();
    final events = [
      _event(
        id: 'root-2',
        kind: EventKind.streamMessageV2,
        content: 'Next page',
        tags: const [
          ['h', _channelId],
        ],
      ),
      _event(
        id: 'summary-2',
        kind: EventKind.channelThreadSummary,
        content: jsonEncode({'latest_activity_at': 800, 'last_reply_at': 800}),
        tags: const [
          ['h', _channelId],
          ['e', 'root-2'],
        ],
      ),
      _event(
        id: 'bounds-2',
        kind: EventKind.channelWindowBounds,
        content: jsonEncode({
          'has_more': true,
          'next_cursor': {'latest_activity_at': 800, 'id': nextId},
        }),
        tags: [
          const ['h', _channelId],
          ['d', '$_channelId:active-threads:900:$cursorId'],
        ],
      ),
    ];

    final page = parseActiveThreadPages(events, {
      _channelId: cursor,
    })[_channelId]!;
    expect(page.rows.single.root.kind, EventKind.streamMessageV2);
    expect(page.hasMore, isTrue);
    expect(page.nextCursor?.latestActivityAt, 800);
    expect(page.nextCursor?.rootId, nextId);
  });

  test('merges paged roots without duplicates and keeps activity order', () {
    ActiveThreadRow row(String id, int activity) => ActiveThreadRow(
      root: _event(id: id, kind: EventKind.streamMessage, content: id),
      latestActivityAt: activity,
      latestReplyAt: activity,
    );

    final merged = mergeActiveThreadRows(
      [row('a', 300), row('b', 200)],
      [row('b', 250), row('c', 100)],
    );
    expect(merged.map((row) => row.root.id), ['a', 'b', 'c']);
    expect(merged[1].latestActivityAt, 250);
  });

  test('live refreshes are limited to replies and deletion mutations', () {
    expect(
      isThreadSidebarLiveMutation(
        _event(id: 'top', kind: EventKind.streamMessage, content: 'top'),
      ),
      isFalse,
    );
    expect(
      isThreadSidebarLiveMutation(
        _event(
          id: 'reply',
          kind: EventKind.streamMessage,
          content: 'reply',
          tags: const [
            ['e', 'root', '', 'reply'],
          ],
        ),
      ),
      isTrue,
    );
    expect(
      isThreadSidebarLiveMutation(
        _event(id: 'delete', kind: EventKind.deletion, content: ''),
      ),
      isTrue,
    );
  });

  test('projects recent threads and excludes stale threads', () {
    final rows = [
      ActiveThreadRow(
        root: _event(
          id: 'recent',
          kind: EventKind.streamMessage,
          content: 'Recent',
        ),
        latestActivityAt: 950,
        latestReplyAt: 950,
      ),
      ActiveThreadRow(
        root: _event(
          id: 'stale',
          kind: EventKind.streamMessage,
          content: 'Old',
        ),
        latestActivityAt: 100,
        latestReplyAt: 100,
      ),
    ];

    final projected = projectThreadRows(
      rows: rows,
      preference: const ChannelThreadSidebarPreference(
        inactivity: ThreadSidebarInactivity.oneDay,
      ),
      nowSeconds: 87_000,
    );

    expect(projected.map((row) => row.root.id), ['recent']);
  });

  test('unread state requires a reply newer than the read frontier', () {
    expect(isThreadSidebarUnread(latestReplyAt: null), isFalse);
    expect(isThreadSidebarUnread(latestReplyAt: 200), isTrue);
    expect(isThreadSidebarUnread(latestReplyAt: 200, readAt: 199), isTrue);
    expect(isThreadSidebarUnread(latestReplyAt: 200, readAt: 200), isFalse);
  });
}
