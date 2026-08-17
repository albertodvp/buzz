import 'dart:async';

import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../../shared/community/community_provider.dart';
import '../../../shared/relay/relay.dart';
import '../channel.dart';
import '../channels_provider.dart';
import 'thread_sidebar_models.dart';
import 'thread_sidebar_query.dart';
import 'thread_sidebar_storage.dart';

class ThreadSidebarState {
  const ThreadSidebarState({
    this.isReady = false,
    this.isRefreshing = false,
    this.preferences = const ThreadSidebarPreferences(),
    this.rowsByChannel = const {},
    this.error,
  });

  final bool isReady;
  final bool isRefreshing;
  final ThreadSidebarPreferences preferences;
  final Map<String, List<ActiveThreadRow>> rowsByChannel;
  final Object? error;

  ChannelThreadSidebarPreference preferenceFor(String channelId) =>
      preferences.forChannel(channelId);

  List<ProjectedThreadRow> threadsFor(String channelId, int nowSeconds) =>
      projectThreadRows(
        rows: rowsByChannel[channelId] ?? const [],
        preference: preferenceFor(channelId),
        nowSeconds: nowSeconds,
      );
}

class ThreadSidebarNotifier extends Notifier<ThreadSidebarState> {
  String? _storageKey;
  ThreadSidebarStorage? _storage;
  List<Channel> _channels = const [];
  Map<String, List<ActiveThreadRow>> _rowsByChannel = const {};
  int _generation = 0;
  int _requestId = 0;
  bool _refreshScheduled = false;

  @override
  ThreadSidebarState build() {
    final community = ref.watch(activeCommunityProvider).value;
    final relayConfig = ref.watch(relayConfigProvider);
    final pubkey = ref.watch(myPubkeyProvider);
    final session = ref.watch(relaySessionProvider);
    final channels = ref.watch(channelsProvider).value ?? const <Channel>[];
    _channels = channels;

    final storage = ref.watch(threadSidebarStorageProvider);
    final nextKey = community == null || pubkey == null
        ? null
        : threadSidebarPreferencesKey(
            relayUrl: relayConfig.baseUrl,
            communityId: community.id,
            pubkey: pubkey,
          );
    final scopeChanged = nextKey != _storageKey;
    if (scopeChanged) {
      _generation++;
      _storageKey = nextKey;
      _storage = nextKey == null ? null : storage;
      _rowsByChannel = const {};
    }
    final preferences = nextKey == null || storage == null
        ? const ThreadSidebarPreferences()
        : storage.read(nextKey);

    if (nextKey != null &&
        session.status == SessionStatus.connected &&
        channels.isNotEmpty) {
      _scheduleRefresh();
    }

    return ThreadSidebarState(
      isReady: nextKey != null,
      preferences: preferences,
      rowsByChannel: _rowsByChannel,
    );
  }

  Future<void> refresh() async {
    final key = _storageKey;
    if (key == null || state.isRefreshing) return;
    final channels = _channels
        .where(
          (channel) =>
              channel.isStream && channel.isMember && !channel.isArchived,
        )
        .toList();
    if (channels.isEmpty) return;

    final generation = _generation;
    final requestId = ++_requestId;
    final nowSeconds = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    state = ThreadSidebarState(
      isReady: state.isReady,
      isRefreshing: true,
      preferences: state.preferences,
      rowsByChannel: state.rowsByChannel,
    );
    try {
      final events = await ref.read(relaySessionProvider.notifier).queryRelay([
        for (final channel in channels)
          activeThreadsFilter(
            channelId: channel.id,
            preference: state.preferenceFor(channel.id),
            nowSeconds: nowSeconds,
          ),
      ]);
      if (generation != _generation ||
          requestId != _requestId ||
          key != _storageKey) {
        return;
      }
      _rowsByChannel = parseActiveThreadBatch(
        events,
        channels.map((channel) => channel.id),
      );
      state = ThreadSidebarState(
        isReady: true,
        preferences: state.preferences,
        rowsByChannel: _rowsByChannel,
      );
    } catch (error) {
      if (generation != _generation ||
          requestId != _requestId ||
          key != _storageKey) {
        return;
      }
      state = ThreadSidebarState(
        isReady: state.isReady,
        preferences: state.preferences,
        rowsByChannel: state.rowsByChannel,
        error: error,
      );
    }
  }

  Future<void> setInactivity(
    String channelId,
    ThreadSidebarInactivity inactivity,
  ) async {
    final key = _storageKey;
    final storage = _storage;
    if (key == null || storage == null) return;
    final now = DateTime.now().millisecondsSinceEpoch;
    final preferences = ThreadSidebarPreferences(
      channels: {
        ...state.preferences.channels,
        channelId: ChannelThreadSidebarPreference(
          inactivity: inactivity,
          updatedAt: now,
        ),
      },
    );
    if (!await storage.write(key, preferences) || key != _storageKey) return;
    state = ThreadSidebarState(
      isReady: true,
      preferences: preferences,
      rowsByChannel: state.rowsByChannel,
    );
    await refresh();
  }

  void _scheduleRefresh() {
    if (_refreshScheduled) return;
    _refreshScheduled = true;
    Future.microtask(() async {
      _refreshScheduled = false;
      await refresh();
    });
  }
}

final threadSidebarProvider =
    NotifierProvider<ThreadSidebarNotifier, ThreadSidebarState>(
      ThreadSidebarNotifier.new,
    );
