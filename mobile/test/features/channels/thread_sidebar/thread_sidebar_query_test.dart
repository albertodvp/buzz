import 'dart:convert';

import 'package:buzz/features/channels/thread_sidebar/thread_sidebar_models.dart';
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
  test(
    'builds the relay active-thread query with local bookmark inclusions',
    () {
      final filter = activeThreadsFilter(
        channelId: _channelId,
        preference: const ChannelThreadSidebarPreference(
          inactivity: ThreadSidebarInactivity.threeDays,
          bookmarks: {'bookmarked-root': ThreadBookmark(updatedAt: 10)},
        ),
        nowSeconds: 1_000_000,
      );

      expect(filter.kinds, [EventKind.streamMessage]);
      expect(filter.tags, {
        '#h': [_channelId],
      });
      expect(filter.limit, 50);
      expect(filter.extensions, {
        'thread_roots_by_activity': true,
        'include_thread_roots': ['bookmarked-root'],
        'thread_active_since': 740800,
      });
    },
  );

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

    final rows = parseActiveThreadBatch(events, const [_channelId]);
    expect(rows[_channelId], hasLength(1));
    expect(rows[_channelId]!.single.root.id, 'root-1');
    expect(rows[_channelId]!.single.latestActivityAt, 900);
    expect(rows[_channelId]!.single.latestReplyAt, 900);
  });

  test('projects recent and bookmarked stale threads independently', () {
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
          id: 'stale-bookmark',
          kind: EventKind.streamMessage,
          content: 'Saved',
        ),
        latestActivityAt: 100,
        latestReplyAt: 100,
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
        bookmarks: {'stale-bookmark': ThreadBookmark(updatedAt: 1)},
      ),
      nowSeconds: 87_000,
    );

    expect(projected.map((row) => row.root.id), ['recent', 'stale-bookmark']);
    expect(projected.last.bookmarked, isTrue);
  });

  test('unread state requires a reply newer than the read frontier', () {
    expect(isThreadSidebarUnread(latestReplyAt: null), isFalse);
    expect(isThreadSidebarUnread(latestReplyAt: 200), isTrue);
    expect(isThreadSidebarUnread(latestReplyAt: 200, readAt: 199), isTrue);
    expect(isThreadSidebarUnread(latestReplyAt: 200, readAt: 200), isFalse);
  });
}
