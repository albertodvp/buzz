import 'dart:convert';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'thread_sidebar_models.dart';

const _storagePrefix = 'buzz-thread-sidebar-preferences.v1';
const _maxChannels = 128;

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
        if (inactivity == null || updatedAt is! int || updatedAt < 0) {
          return const ThreadSidebarPreferences();
        }
        channels[channelId] = ChannelThreadSidebarPreference(
          inactivity: inactivity,
          updatedAt: updatedAt,
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
            },
        },
      }),
    );
  }
}
