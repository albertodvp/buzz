import '../../../shared/relay/relay.dart';

enum ThreadSidebarInactivity {
  oneDay('1d', '1 day'),
  threeDays('3d', '3 days'),
  sevenDays('7d', '7 days'),
  thirtyDays('30d', '30 days'),
  never('never', 'Never'),
  bookmarksOnly('bookmarks-only', 'Only bookmarks');

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

class ThreadBookmark {
  const ThreadBookmark({required this.updatedAt});

  final int updatedAt;
}

class ChannelThreadSidebarPreference {
  const ChannelThreadSidebarPreference({
    this.inactivity = defaultThreadSidebarInactivity,
    this.updatedAt = 0,
    this.bookmarks = const {},
  });

  final ThreadSidebarInactivity inactivity;
  final int updatedAt;
  final Map<String, ThreadBookmark> bookmarks;
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

class ProjectedThreadRow {
  const ProjectedThreadRow({
    required this.root,
    required this.latestActivityAt,
    required this.latestReplyAt,
    required this.bookmarked,
  });

  final NostrEvent root;
  final int latestActivityAt;
  final int? latestReplyAt;
  final bool bookmarked;
}

bool isThreadSidebarUnread({required int? latestReplyAt, int? readAt}) =>
    latestReplyAt != null && latestReplyAt > (readAt ?? 0);

int? threadSidebarCutoff(ThreadSidebarInactivity inactivity, int nowSeconds) =>
    switch (inactivity) {
      ThreadSidebarInactivity.oneDay => nowSeconds - 86400,
      ThreadSidebarInactivity.threeDays => nowSeconds - (3 * 86400),
      ThreadSidebarInactivity.sevenDays => nowSeconds - (7 * 86400),
      ThreadSidebarInactivity.thirtyDays => nowSeconds - (30 * 86400),
      ThreadSidebarInactivity.never ||
      ThreadSidebarInactivity.bookmarksOnly => null,
    };

List<ProjectedThreadRow> projectThreadRows({
  required Iterable<ActiveThreadRow> rows,
  required ChannelThreadSidebarPreference preference,
  required int nowSeconds,
}) {
  final cutoff = threadSidebarCutoff(preference.inactivity, nowSeconds);
  final projected = <ProjectedThreadRow>[];
  for (final row in rows) {
    final bookmarked = preference.bookmarks.containsKey(row.root.id);
    final automatic = switch (preference.inactivity) {
      ThreadSidebarInactivity.never => true,
      ThreadSidebarInactivity.bookmarksOnly => false,
      _ => cutoff != null && row.latestActivityAt >= cutoff,
    };
    if (!bookmarked && !automatic) continue;
    projected.add(
      ProjectedThreadRow(
        root: row.root,
        latestActivityAt: row.latestActivityAt,
        latestReplyAt: row.latestReplyAt,
        bookmarked: bookmarked,
      ),
    );
  }
  projected.sort((left, right) {
    final byActivity = right.latestActivityAt.compareTo(left.latestActivityAt);
    return byActivity != 0 ? byActivity : left.root.id.compareTo(right.root.id);
  });
  return projected;
}
