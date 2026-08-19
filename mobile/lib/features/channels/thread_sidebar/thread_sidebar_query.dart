import 'dart:convert';

import '../../../shared/relay/relay.dart';
import 'thread_sidebar_models.dart';

const _maxSupportedTimestamp = 253402300799;

NostrFilter activeThreadsFilter({
  required String channelId,
  required ChannelThreadSidebarPreference preference,
  required int nowSeconds,
  ActiveThreadCursor? cursor,
}) {
  final cutoff = threadSidebarCutoff(preference.inactivity, nowSeconds);
  return NostrFilter(
    kinds: EventKind.channelTimelineContentKinds,
    tags: {
      '#h': [channelId],
    },
    limit: 50,
    extensions: {
      'thread_roots_by_activity': true,
      'thread_active_since': ?cutoff,
      if (cursor != null) 'thread_activity_cursor': cursor.latestActivityAt,
      if (cursor != null) 'thread_activity_cursor_id': cursor.rootId,
    },
  );
}

Map<String, ActiveThreadPage> parseActiveThreadBatch(
  List<NostrEvent> events,
  Iterable<String> channelIds,
) => parseActiveThreadPages(events, {
  for (final channelId in channelIds) channelId: null,
});

Map<String, ActiveThreadPage> parseActiveThreadPages(
  List<NostrEvent> events,
  Map<String, ActiveThreadCursor?> cursorsByChannel,
) => {
  for (final entry in cursorsByChannel.entries)
    entry.key: _parseChannelPage(events, entry.key, entry.value),
};

ActiveThreadPage _parseChannelPage(
  List<NostrEvent> events,
  String channelId,
  ActiveThreadCursor? cursor,
) {
  final roots = <String, NostrEvent>{};
  for (final event in events) {
    if (!EventKind.channelTimelineContentKinds.contains(event.kind) ||
        event.channelId != channelId) {
      continue;
    }
    roots.putIfAbsent(event.id, () => event);
  }

  final activityByRoot = <String, ({int activity, int? latestReply})>{};
  for (final event in events) {
    if (event.kind != EventKind.channelThreadSummary ||
        event.channelId != channelId) {
      continue;
    }
    final rootId = event.getTagValue('e');
    if (rootId == null || !roots.containsKey(rootId)) continue;
    final dynamic decoded = jsonDecode(event.content);
    if (decoded is! Map) {
      throw const FormatException('invalid active-thread summary');
    }
    final rawActivity =
        decoded['latest_activity_at'] ?? decoded['last_reply_at'];
    if (rawActivity is! int ||
        rawActivity < 0 ||
        rawActivity > _maxSupportedTimestamp) {
      throw const FormatException('invalid active-thread activity');
    }
    final rawLatestReply = decoded['last_reply_at'];
    if (rawLatestReply != null &&
        (rawLatestReply is! int ||
            rawLatestReply < 0 ||
            rawLatestReply > _maxSupportedTimestamp)) {
      throw const FormatException('invalid active-thread latest reply');
    }
    activityByRoot.putIfAbsent(
      rootId,
      () => (activity: rawActivity, latestReply: rawLatestReply as int?),
    );
  }

  final bounds = events.where(
    (event) =>
        event.kind == EventKind.channelWindowBounds &&
        event.channelId == channelId &&
        event.getTagValue('d') == _requestKey(channelId, cursor),
  );
  if (bounds.isEmpty) {
    if (roots.isNotEmpty || activityByRoot.isNotEmpty) {
      throw FormatException('missing active-thread bounds for $channelId');
    }
    // Membership can change between the local channel snapshot and the relay
    // query. The relay intentionally omits inaccessible channel frames; keep
    // valid sibling pages instead of rejecting the whole batch.
    return const ActiveThreadPage(rows: [], hasMore: false, nextCursor: null);
  }
  if (bounds.length > 1) {
    throw FormatException('missing active-thread bounds for $channelId');
  }
  final dynamic decodedBounds = jsonDecode(bounds.single.content);
  if (decodedBounds is! Map || decodedBounds['has_more'] is! bool) {
    throw const FormatException('invalid active-thread bounds');
  }

  final hasMore = decodedBounds['has_more'] as bool;
  final rawCursor = decodedBounds['next_cursor'];
  ActiveThreadCursor? nextCursor;
  if (rawCursor != null) {
    if (rawCursor is! Map ||
        rawCursor['latest_activity_at'] is! int ||
        (rawCursor['latest_activity_at'] as int) < 0 ||
        (rawCursor['latest_activity_at'] as int) > _maxSupportedTimestamp ||
        rawCursor['id'] is! String ||
        !_isEventId(rawCursor['id'] as String)) {
      throw const FormatException('invalid active-thread cursor');
    }
    nextCursor = ActiveThreadCursor(
      latestActivityAt: rawCursor['latest_activity_at'] as int,
      rootId: (rawCursor['id'] as String).toLowerCase(),
    );
  }
  if (hasMore != (nextCursor != null)) {
    throw const FormatException('active-thread bounds and cursor disagree');
  }

  final rows = [
    for (final root in roots.entries)
      if (activityByRoot[root.key] case final summary?)
        ActiveThreadRow(
          root: root.value,
          latestActivityAt: summary.activity,
          latestReplyAt: summary.latestReply,
        ),
  ];
  rows.sort((left, right) {
    final byActivity = right.latestActivityAt.compareTo(left.latestActivityAt);
    return byActivity != 0 ? byActivity : left.root.id.compareTo(right.root.id);
  });
  return ActiveThreadPage(rows: rows, hasMore: hasMore, nextCursor: nextCursor);
}

String _requestKey(String channelId, ActiveThreadCursor? cursor) =>
    '$channelId:active-threads:${cursor == null ? 'head' : '${cursor.latestActivityAt}:${cursor.rootId.toLowerCase()}'}';

bool _isEventId(String value) =>
    value.length == 64 && RegExp(r'^[0-9a-fA-F]+$').hasMatch(value);

bool isThreadSidebarLiveMutation(NostrEvent event) {
  final isDeletion =
      event.kind == EventKind.deletion ||
      event.kind == EventKind.nip29DeleteEvent;
  final isReply = event.tags.any((tag) => tag.length >= 2 && tag.first == 'e');
  return isDeletion || isReply;
}
