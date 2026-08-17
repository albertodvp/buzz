import 'dart:convert';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'thread_sidebar_models.dart';

const _storagePrefix = 'buzz-thread-sidebar-preferences.v1';
const _maxChannels = 128;
const _maxBookmarksPerChannel = 256;

/// Injected by the application root. Keeping the default empty makes isolated
/// widget previews render recent relay threads without requiring disk state.
final threadSidebarStorageProvider = Provider<ThreadSidebarStorage?>(
  (_) => null,
);

String threadSidebarPreferencesKey({
  required String relayUrl,
  required String communityId,
  required String pubkey,
}) {
  final uri = Uri.tryParse(relayUrl);
  final normalizedRelay = uri == null
      ? relayUrl.trim().toLowerCase()
      : uri
            .replace(
              scheme: switch (uri.scheme) {
                'wss' => 'https',
                'ws' => 'http',
                _ => uri.scheme,
              },
              path: uri.path == '/' ? '' : uri.path,
            )
            .toString()
            .replaceFirst(RegExp(r'/$'), '')
            .toLowerCase();
  return '$_storagePrefix:$normalizedRelay:${communityId.toLowerCase()}:${pubkey.toLowerCase()}';
}

class ThreadSidebarStorage {
  const ThreadSidebarStorage(this._prefs);

  final SharedPreferences _prefs;

  ThreadSidebarPreferences read(String key) {
    final raw = _prefs.getString(key);
    if (raw == null || raw.isEmpty) return const ThreadSidebarPreferences();
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic> || decoded['version'] != 1) {
        return const ThreadSidebarPreferences();
      }
      final rawChannels = decoded['channels'];
      if (rawChannels is! Map || rawChannels.length > _maxChannels) {
        return const ThreadSidebarPreferences();
      }
      final channels = <String, ChannelThreadSidebarPreference>{};
      for (final rawEntry in rawChannels.entries) {
        final channelId = rawEntry.key;
        final value = rawEntry.value;
        if (channelId is! String || value is! Map) {
          return const ThreadSidebarPreferences();
        }
        final inactivity = ThreadSidebarInactivity.fromStorage(
          value['inactivity'] as String? ?? '',
        );
        final updatedAt = value['updatedAt'];
        final rawBookmarks = value['bookmarks'];
        if (inactivity == null ||
            updatedAt is! int ||
            updatedAt < 0 ||
            rawBookmarks is! Map ||
            rawBookmarks.length > _maxBookmarksPerChannel) {
          return const ThreadSidebarPreferences();
        }
        final bookmarks = <String, ThreadBookmark>{};
        for (final bookmark in rawBookmarks.entries) {
          final rootId = bookmark.key;
          final bookmarkValue = bookmark.value;
          if (rootId is! String ||
              bookmarkValue is! Map ||
              bookmarkValue['updatedAt'] is! int ||
              (bookmarkValue['updatedAt'] as int) < 0) {
            return const ThreadSidebarPreferences();
          }
          bookmarks[rootId] = ThreadBookmark(
            updatedAt: bookmarkValue['updatedAt'] as int,
          );
        }
        channels[channelId] = ChannelThreadSidebarPreference(
          inactivity: inactivity,
          updatedAt: updatedAt,
          bookmarks: bookmarks,
        );
      }
      return ThreadSidebarPreferences(channels: channels);
    } catch (_) {
      return const ThreadSidebarPreferences();
    }
  }

  Future<bool> write(String key, ThreadSidebarPreferences preferences) {
    final channelEntries = preferences.channels.entries.toList()
      ..sort(
        (left, right) => left.value.updatedAt.compareTo(right.value.updatedAt),
      );
    final boundedChannels = channelEntries.length <= _maxChannels
        ? channelEntries
        : channelEntries.sublist(channelEntries.length - _maxChannels);
    return _prefs.setString(
      key,
      jsonEncode({
        'version': 1,
        'channels': {
          for (final channel in boundedChannels)
            channel.key: {
              'inactivity': channel.value.inactivity.storageValue,
              'updatedAt': channel.value.updatedAt,
              'bookmarks': {
                for (final bookmark in _boundedBookmarks(
                  channel.value.bookmarks,
                ).entries)
                  bookmark.key: {'updatedAt': bookmark.value.updatedAt},
              },
            },
        },
      }),
    );
  }
}

Map<String, ThreadBookmark> _boundedBookmarks(
  Map<String, ThreadBookmark> bookmarks,
) {
  final entries = bookmarks.entries.toList()
    ..sort((left, right) {
      final byUpdated = left.value.updatedAt.compareTo(right.value.updatedAt);
      return byUpdated != 0 ? byUpdated : left.key.compareTo(right.key);
    });
  final bounded = entries.length <= _maxBookmarksPerChannel
      ? entries
      : entries.sublist(entries.length - _maxBookmarksPerChannel);
  return {for (final entry in bounded) entry.key: entry.value};
}
