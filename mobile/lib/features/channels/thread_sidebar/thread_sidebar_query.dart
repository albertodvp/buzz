import 'dart:convert';

import '../../../shared/relay/relay.dart';
import 'thread_sidebar_models.dart';

const _maxSupportedTimestamp = 253402300799;

NostrFilter activeThreadsFilter({
  required String channelId,
  required ChannelThreadSidebarPreference preference,
  required int nowSeconds,
}) {
  final cutoff = threadSidebarCutoff(preference.inactivity, nowSeconds);
  return NostrFilter(
    kinds: const [EventKind.streamMessage],
    tags: {
      '#h': [channelId],
    },
    limit: 50,
    extensions: {
      'thread_roots_by_activity': true,
      'thread_active_since': ?cutoff,
    },
  );
}

Map<String, List<ActiveThreadRow>> parseActiveThreadBatch(
  List<NostrEvent> events,
  Iterable<String> channelIds,
) => {
  for (final channelId in channelIds)
    channelId: _parseChannelRows(events, channelId),
};

List<ActiveThreadRow> _parseChannelRows(
  List<NostrEvent> events,
  String channelId,
) {
  final roots = <String, NostrEvent>{};
  for (final event in events) {
    if (event.kind != EventKind.streamMessage || event.channelId != channelId) {
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
        event.getTagValue('d') == '$channelId:active-threads:head',
  );
  if (bounds.length != 1) {
    throw FormatException('missing active-thread bounds for $channelId');
  }
  final dynamic decodedBounds = jsonDecode(bounds.single.content);
  if (decodedBounds is! Map || decodedBounds['has_more'] is! bool) {
    throw const FormatException('invalid active-thread bounds');
  }

  return [
    for (final root in roots.entries)
      if (activityByRoot[root.key] case final summary?)
        ActiveThreadRow(
          root: root.value,
          latestActivityAt: summary.activity,
          latestReplyAt: summary.latestReply,
        ),
  ];
}
