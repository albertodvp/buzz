import '../../../shared/relay/relay.dart';

enum ThreadSidebarInactivity {
  oneDay('1d', '1 day'),
  threeDays('3d', '3 days'),
  sevenDays('7d', '7 days'),
  thirtyDays('30d', '30 days'),
  never('never', 'Never');

  const ThreadSidebarInactivity(this.storageValue, this.label);

  final String storageValue;
  final String label;

  static ThreadSidebarInactivity? fromStorage(String value) {
    for (final choice in values) {
      if (choice.storageValue == value) return choice;
    }
    return null;
  }
}

const defaultThreadSidebarInactivity = ThreadSidebarInactivity.threeDays;

class ChannelThreadSidebarPreference {
  const ChannelThreadSidebarPreference({
    this.inactivity = defaultThreadSidebarInactivity,
    this.updatedAt = 0,
  });

  final ThreadSidebarInactivity inactivity;
  final int updatedAt;
}

class ThreadSidebarPreferences {
  const ThreadSidebarPreferences({this.channels = const {}});

  final Map<String, ChannelThreadSidebarPreference> channels;

  ChannelThreadSidebarPreference forChannel(String channelId) =>
      channels[channelId] ?? const ChannelThreadSidebarPreference();
}

class ActiveThreadRow {
  const ActiveThreadRow({
    required this.root,
    required this.latestActivityAt,
    required this.latestReplyAt,
  });

  final NostrEvent root;
  final int latestActivityAt;
  final int? latestReplyAt;
}

class ActiveThreadCursor {
  const ActiveThreadCursor({
    required this.latestActivityAt,
    required this.rootId,
  });

  final int latestActivityAt;
  final String rootId;
}

class ActiveThreadPage {
  const ActiveThreadPage({
    required this.rows,
    required this.hasMore,
    required this.nextCursor,
  });

  final List<ActiveThreadRow> rows;
  final bool hasMore;
  final ActiveThreadCursor? nextCursor;
}

List<ActiveThreadRow> mergeActiveThreadRows(
  Iterable<ActiveThreadRow> current,
  Iterable<ActiveThreadRow> incoming,
) {
  final byRoot = <String, ActiveThreadRow>{};
  for (final row in [...current, ...incoming]) {
    final previous = byRoot[row.root.id];
    if (previous == null || row.latestActivityAt > previous.latestActivityAt) {
      byRoot[row.root.id] = row;
    }
  }
  final rows = byRoot.values.toList();
  rows.sort((left, right) {
    final byActivity = right.latestActivityAt.compareTo(left.latestActivityAt);
    return byActivity != 0 ? byActivity : left.root.id.compareTo(right.root.id);
  });
  return rows;
}

class ProjectedThreadRow {
  const ProjectedThreadRow({
    required this.root,
    required this.latestActivityAt,
    required this.latestReplyAt,
  });

  final NostrEvent root;
  final int latestActivityAt;
  final int? latestReplyAt;
}

bool isThreadSidebarUnread({required int? latestReplyAt, int? readAt}) =>
    latestReplyAt != null && latestReplyAt > (readAt ?? 0);

int? threadSidebarCutoff(ThreadSidebarInactivity inactivity, int nowSeconds) =>
    switch (inactivity) {
      ThreadSidebarInactivity.oneDay => nowSeconds - 86400,
      ThreadSidebarInactivity.threeDays => nowSeconds - (3 * 86400),
      ThreadSidebarInactivity.sevenDays => nowSeconds - (7 * 86400),
      ThreadSidebarInactivity.thirtyDays => nowSeconds - (30 * 86400),
      ThreadSidebarInactivity.never => null,
    };

List<ProjectedThreadRow> projectThreadRows({
  required Iterable<ActiveThreadRow> rows,
  required ChannelThreadSidebarPreference preference,
  required int nowSeconds,
}) {
  final cutoff = threadSidebarCutoff(preference.inactivity, nowSeconds);
  final projected = <ProjectedThreadRow>[];
  for (final row in rows) {
    final automatic = switch (preference.inactivity) {
      ThreadSidebarInactivity.never => true,
      _ => cutoff != null && row.latestActivityAt >= cutoff,
    };
    if (!automatic) continue;
    projected.add(
      ProjectedThreadRow(
        root: row.root,
        latestActivityAt: row.latestActivityAt,
        latestReplyAt: row.latestReplyAt,
      ),
    );
  }
  projected.sort((left, right) {
    final byActivity = right.latestActivityAt.compareTo(left.latestActivityAt);
    return byActivity != 0 ? byActivity : left.root.id.compareTo(right.root.id);
  });
  return projected;
}
