import 'dart:async';

import 'package:flutter/foundation.dart';
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
    this.nextCursorByChannel = const {},
    this.loadingMoreChannelIds = const {},
    this.error,
  });

  final bool isReady;
  final bool isRefreshing;
  final ThreadSidebarPreferences preferences;
  final Map<String, List<ActiveThreadRow>> rowsByChannel;
  final Map<String, ActiveThreadCursor> nextCursorByChannel;
  final Set<String> loadingMoreChannelIds;
  final Object? error;

  ChannelThreadSidebarPreference preferenceFor(String channelId) =>
      preferences.forChannel(channelId);

  bool hasMore(String channelId) => nextCursorByChannel.containsKey(channelId);

  bool isLoadingMore(String channelId) =>
      loadingMoreChannelIds.contains(channelId);

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
  Map<String, ActiveThreadCursor> _nextCursorByChannel = const {};
  int _generation = 0;
  int _requestId = 0;
  bool _refreshScheduled = false;
  bool _refreshAfterCurrent = false;
  void Function()? _unsubscribeLive;
  String? _liveSubscriptionKey;
  int _liveSubscriptionGeneration = 0;
  Timer? _liveRefreshTimer;

  @override
  ThreadSidebarState build() {
    ref.onDispose(_dispose);
    final community = ref.watch(activeCommunityProvider).value;
    final relayConfig = ref.watch(relayConfigProvider);
    final pubkey = ref.watch(myPubkeyProvider);
    final session = ref.watch(relaySessionProvider);
    ref.watch(
      channelsProvider.select((value) {
        final ids = [
          for (final channel in value.value ?? const <Channel>[])
            if (channel.isStream && channel.isMember && !channel.isArchived)
              channel.id,
        ]..sort();
        return ids.join('\u0000');
      }),
    );
    final channels = [
      for (final channel
          in ref.read(channelsProvider).value ?? const <Channel>[])
        if (channel.isStream && channel.isMember && !channel.isArchived)
          channel,
    ];
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
      _nextCursorByChannel = const {};
      _clearLiveSubscription();
    }
    final preferences = nextKey == null || storage == null
        ? const ThreadSidebarPreferences()
        : storage.read(nextKey);

    if (nextKey != null &&
        session.status == SessionStatus.connected &&
        channels.isNotEmpty) {
      _scheduleRefresh();
      _ensureLiveSubscription(channels);
    } else {
      _clearLiveSubscription();
    }

    return ThreadSidebarState(
      isReady: nextKey != null,
      preferences: preferences,
      rowsByChannel: _rowsByChannel,
      nextCursorByChannel: _nextCursorByChannel,
    );
  }

  Future<void> refresh() async {
    final key = _storageKey;
    if (key == null) return;
    if (state.isRefreshing) {
      _refreshAfterCurrent = true;
      return;
    }
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
      nextCursorByChannel: state.nextCursorByChannel,
      loadingMoreChannelIds: state.loadingMoreChannelIds,
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
      final pages = parseActiveThreadBatch(
        events,
        channels.map((channel) => channel.id),
      );
      _rowsByChannel = {
        for (final entry in pages.entries) entry.key: entry.value.rows,
      };
      _nextCursorByChannel = {
        for (final entry in pages.entries) entry.key: ?entry.value.nextCursor,
      };
      state = ThreadSidebarState(
        isReady: true,
        preferences: state.preferences,
        rowsByChannel: _rowsByChannel,
        nextCursorByChannel: _nextCursorByChannel,
        loadingMoreChannelIds: state.loadingMoreChannelIds,
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
        nextCursorByChannel: state.nextCursorByChannel,
        loadingMoreChannelIds: state.loadingMoreChannelIds,
        error: error,
      );
    } finally {
      if (_refreshAfterCurrent) {
        _refreshAfterCurrent = false;
        _scheduleRefresh();
      }
    }
  }

  Future<void> loadMore(String channelId) async {
    final key = _storageKey;
    final cursor = _nextCursorByChannel[channelId];
    if (key == null ||
        cursor == null ||
        state.loadingMoreChannelIds.contains(channelId) ||
        state.isRefreshing) {
      return;
    }
    final generation = _generation;
    final loading = {...state.loadingMoreChannelIds, channelId};
    state = ThreadSidebarState(
      isReady: state.isReady,
      isRefreshing: state.isRefreshing,
      preferences: state.preferences,
      rowsByChannel: state.rowsByChannel,
      nextCursorByChannel: state.nextCursorByChannel,
      loadingMoreChannelIds: loading,
    );
    try {
      final nowSeconds = DateTime.now().millisecondsSinceEpoch ~/ 1000;
      final events = await ref.read(relaySessionProvider.notifier).queryRelay([
        activeThreadsFilter(
          channelId: channelId,
          preference: state.preferenceFor(channelId),
          nowSeconds: nowSeconds,
          cursor: cursor,
        ),
      ]);
      if (generation != _generation ||
          key != _storageKey ||
          _nextCursorByChannel[channelId] != cursor) {
        if (generation == _generation && key == _storageKey) {
          _finishLoadingMore(channelId);
        }
        return;
      }
      final page = parseActiveThreadPages(events, {
        channelId: cursor,
      })[channelId]!;
      _rowsByChannel = {
        ..._rowsByChannel,
        channelId: mergeActiveThreadRows(
          _rowsByChannel[channelId] ?? const [],
          page.rows,
        ),
      };
      final nextCursors = {..._nextCursorByChannel}..remove(channelId);
      if (page.nextCursor case final next?) {
        nextCursors[channelId] = next;
      }
      _nextCursorByChannel = nextCursors;
      state = ThreadSidebarState(
        isReady: true,
        preferences: state.preferences,
        rowsByChannel: _rowsByChannel,
        nextCursorByChannel: _nextCursorByChannel,
        loadingMoreChannelIds: {...state.loadingMoreChannelIds}
          ..remove(channelId),
      );
    } catch (error) {
      if (generation != _generation || key != _storageKey) return;
      state = ThreadSidebarState(
        isReady: state.isReady,
        preferences: state.preferences,
        rowsByChannel: state.rowsByChannel,
        nextCursorByChannel: state.nextCursorByChannel,
        loadingMoreChannelIds: {...state.loadingMoreChannelIds}
          ..remove(channelId),
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
      nextCursorByChannel: state.nextCursorByChannel,
      loadingMoreChannelIds: state.loadingMoreChannelIds,
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

  void _ensureLiveSubscription(List<Channel> channels) {
    final channelIds = channels.map((channel) => channel.id).toList()..sort();
    final key = '${_storageKey ?? ''}:${channelIds.join(',')}';
    if (_liveSubscriptionKey == key) return;
    _clearLiveSubscription();
    _liveSubscriptionKey = key;
    final generation = ++_liveSubscriptionGeneration;
    Future.microtask(() async {
      try {
        final unsubscribe = await ref
            .read(relaySessionProvider.notifier)
            .subscribe(
              NostrFilter(
                kinds: const [
                  ...EventKind.channelTimelineContentKinds,
                  EventKind.deletion,
                  EventKind.nip29DeleteEvent,
                ],
                tags: {'#h': channelIds},
                since: DateTime.now().millisecondsSinceEpoch ~/ 1000,
                limit: 0,
              ),
              _handleLiveEvent,
            );
        if (generation != _liveSubscriptionGeneration ||
            _liveSubscriptionKey != key) {
          unsubscribe();
          return;
        }
        _unsubscribeLive = unsubscribe;
      } catch (error) {
        if (generation != _liveSubscriptionGeneration) return;
        _liveSubscriptionKey = null;
        debugPrint('[ThreadSidebarNotifier] live subscription failed: $error');
      }
    });
  }

  void _handleLiveEvent(NostrEvent event) {
    if (!isThreadSidebarLiveMutation(event)) return;
    _liveRefreshTimer?.cancel();
    _liveRefreshTimer = Timer(
      const Duration(milliseconds: 150),
      _scheduleRefresh,
    );
  }

  void _finishLoadingMore(String channelId) {
    if (!state.loadingMoreChannelIds.contains(channelId)) return;
    state = ThreadSidebarState(
      isReady: state.isReady,
      isRefreshing: state.isRefreshing,
      preferences: state.preferences,
      rowsByChannel: state.rowsByChannel,
      nextCursorByChannel: state.nextCursorByChannel,
      loadingMoreChannelIds: {...state.loadingMoreChannelIds}
        ..remove(channelId),
      error: state.error,
    );
  }

  void _clearLiveSubscription() {
    _liveSubscriptionGeneration++;
    _unsubscribeLive?.call();
    _unsubscribeLive = null;
    _liveSubscriptionKey = null;
  }

  void _dispose() {
    _clearLiveSubscription();
    _liveRefreshTimer?.cancel();
    _liveRefreshTimer = null;
  }
}

final threadSidebarProvider =
    NotifierProvider<ThreadSidebarNotifier, ThreadSidebarState>(
      ThreadSidebarNotifier.new,
    );
