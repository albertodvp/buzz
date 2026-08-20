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

const maxThreadSidebarChannelsPerQuery = 8;
const maxThreadSidebarChannelsPerSubscription = 128;

List<List<T>> _threadSidebarChunks<T>(List<T> values, int size) => [
  for (var start = 0; start < values.length; start += size)
    values.sublist(
      start,
      start + size < values.length ? start + size : values.length,
    ),
];

List<List<T>> threadSidebarQueryChunks<T>(List<T> values) =>
    _threadSidebarChunks(values, maxThreadSidebarChannelsPerQuery);

List<List<T>> threadSidebarSubscriptionChunks<T>(List<T> values) =>
    _threadSidebarChunks(values, maxThreadSidebarChannelsPerSubscription);

class ThreadSidebarLiveRefreshQueue {
  final Set<String> _channelIds = {};

  void add(NostrEvent event) {
    final channelId = event.channelId;
    if (channelId != null && channelId.isNotEmpty) _channelIds.add(channelId);
  }

  Set<String> take() {
    final result = Set<String>.of(_channelIds);
    _channelIds.clear();
    return result;
  }

  void clear() => _channelIds.clear();
}

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
  final Set<String> _channelRefreshAfterCurrent = {};
  final ThreadSidebarLiveRefreshQueue _liveRefreshQueue =
      ThreadSidebarLiveRefreshQueue();
  bool _isDisposed = false;
  final Map<String, void Function()> _liveUnsubscribers = {};
  final Set<String> _pendingLiveChunks = {};
  String? _liveSubscriptionKey;
  int _liveSubscriptionGeneration = 0;
  Timer? _liveRefreshTimer;
  Timer? _liveRetryTimer;
  Timer? _expiryTimer;

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

  Future<void> refresh() => _refreshChannels();

  Future<void> _refreshChannels([Set<String>? requestedChannelIds]) async {
    if (_isDisposed) return;
    final key = _storageKey;
    if (key == null) return;
    if (state.isRefreshing) {
      if (requestedChannelIds == null) {
        _refreshAfterCurrent = true;
        _channelRefreshAfterCurrent.clear();
      } else if (!_refreshAfterCurrent) {
        _channelRefreshAfterCurrent.addAll(requestedChannelIds);
      }
      return;
    }
    final channels = _channels
        .where(
          (channel) =>
              channel.isStream &&
              channel.isMember &&
              !channel.isArchived &&
              (requestedChannelIds == null ||
                  requestedChannelIds.contains(channel.id)),
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
      final pages = <String, ActiveThreadPage>{};
      Object? firstError;
      for (final chunk in threadSidebarQueryChunks(channels)) {
        if (_isDisposed ||
            generation != _generation ||
            requestId != _requestId ||
            key != _storageKey) {
          return;
        }
        try {
          final events = await ref
              .read(relaySessionProvider.notifier)
              .queryRelay([
                for (final channel in chunk)
                  activeThreadsFilter(
                    channelId: channel.id,
                    preference: state.preferenceFor(channel.id),
                    nowSeconds: nowSeconds,
                  ),
              ]);
          if (_isDisposed ||
              generation != _generation ||
              requestId != _requestId ||
              key != _storageKey) {
            return;
          }
          pages.addAll(
            parseActiveThreadBatch(events, chunk.map((channel) => channel.id)),
          );
        } catch (error) {
          firstError ??= error;
        }
      }
      if (_isDisposed) return;
      final eligibleIds = _channels
          .where(
            (channel) =>
                channel.isStream && channel.isMember && !channel.isArchived,
          )
          .map((channel) => channel.id)
          .toSet();
      _rowsByChannel = {
        for (final entry in _rowsByChannel.entries)
          if (requestedChannelIds != null || eligibleIds.contains(entry.key))
            entry.key: entry.value,
        for (final entry in pages.entries) entry.key: entry.value.rows,
      };
      _nextCursorByChannel = {
        for (final entry in _nextCursorByChannel.entries)
          if ((requestedChannelIds != null ||
                  eligibleIds.contains(entry.key)) &&
              !pages.containsKey(entry.key))
            entry.key: entry.value,
        for (final entry in pages.entries) entry.key: ?entry.value.nextCursor,
      };
      state = ThreadSidebarState(
        isReady: true,
        preferences: state.preferences,
        rowsByChannel: _rowsByChannel,
        nextCursorByChannel: _nextCursorByChannel,
        loadingMoreChannelIds: state.loadingMoreChannelIds,
        error: firstError,
      );
      _scheduleExpiry();
    } catch (error) {
      if (_isDisposed ||
          generation != _generation ||
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
      if (!_isDisposed) {
        if (_refreshAfterCurrent) {
          _refreshAfterCurrent = false;
          _channelRefreshAfterCurrent.clear();
          _scheduleRefresh();
        } else if (_channelRefreshAfterCurrent.isNotEmpty) {
          final channelIds = Set<String>.of(_channelRefreshAfterCurrent);
          _channelRefreshAfterCurrent.clear();
          _scheduleChannelRefresh(channelIds);
        }
      }
    }
  }

  Future<void> loadMore(String channelId) async {
    if (_isDisposed) return;
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
      if (_isDisposed ||
          generation != _generation ||
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
      _scheduleExpiry();
    } catch (error) {
      if (_isDisposed || generation != _generation || key != _storageKey) {
        return;
      }
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
    if (_isDisposed) return;
    final key = _storageKey;
    final storage = _storage;
    if (key == null || storage == null) return;
    final now = DateTime.now().millisecondsSinceEpoch;
    final preferences = storage.normalize(
      ThreadSidebarPreferences(
        channels: {
          ...state.preferences.channels,
          channelId: ChannelThreadSidebarPreference(
            inactivity: inactivity,
            updatedAt: now,
          ),
        },
      ),
    );
    if (!await storage.write(key, preferences) ||
        _isDisposed ||
        key != _storageKey) {
      return;
    }
    state = ThreadSidebarState(
      isReady: true,
      preferences: preferences,
      rowsByChannel: state.rowsByChannel,
      nextCursorByChannel: state.nextCursorByChannel,
      loadingMoreChannelIds: state.loadingMoreChannelIds,
    );
    _scheduleExpiry();
    await refresh();
  }

  void _scheduleRefresh() {
    if (_isDisposed || _refreshScheduled) return;
    _refreshScheduled = true;
    Future.microtask(() async {
      _refreshScheduled = false;
      if (_isDisposed) return;
      await refresh();
    });
  }

  void _scheduleChannelRefresh(Set<String> channelIds) {
    if (_isDisposed || channelIds.isEmpty) return;
    Future.microtask(() => _refreshChannels(channelIds));
  }

  void _ensureLiveSubscription(List<Channel> channels) {
    final channelIds = channels.map((channel) => channel.id).toList()..sort();
    final key = '${_storageKey ?? ''}:${channelIds.join(',')}';
    if (_liveSubscriptionKey != key) {
      _clearLiveSubscription();
      _liveSubscriptionKey = key;
    }
    final generation = _liveSubscriptionGeneration;
    for (final chunk in threadSidebarSubscriptionChunks(channelIds)) {
      final chunkKey = chunk.join(',');
      if (_liveUnsubscribers.containsKey(chunkKey) ||
          !_pendingLiveChunks.add(chunkKey)) {
        continue;
      }
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
                  tags: {'#h': chunk},
                  since: DateTime.now().millisecondsSinceEpoch ~/ 1000,
                  limit: 0,
                ),
                _handleLiveEvent,
              );
          if (_isDisposed ||
              generation != _liveSubscriptionGeneration ||
              _liveSubscriptionKey != key) {
            unsubscribe();
            return;
          }
          _liveUnsubscribers[chunkKey] = unsubscribe;
        } catch (error) {
          if (_isDisposed || generation != _liveSubscriptionGeneration) return;
          debugPrint(
            '[ThreadSidebarNotifier] live subscription failed: $error',
          );
          _liveRetryTimer ??= Timer(const Duration(seconds: 1), () {
            _liveRetryTimer = null;
            if (!_isDisposed) _ensureLiveSubscription(_channels);
          });
        } finally {
          if (generation == _liveSubscriptionGeneration) {
            _pendingLiveChunks.remove(chunkKey);
          }
        }
      });
    }
  }

  void _handleLiveEvent(NostrEvent event) {
    if (!isThreadSidebarLiveMutation(event)) return;
    _liveRefreshQueue.add(event);
    _liveRefreshTimer?.cancel();
    _liveRefreshTimer = Timer(
      const Duration(milliseconds: 150),
      () => _scheduleChannelRefresh(_liveRefreshQueue.take()),
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
    for (final unsubscribe in _liveUnsubscribers.values) {
      unsubscribe();
    }
    _liveUnsubscribers.clear();
    _pendingLiveChunks.clear();
    _liveRefreshQueue.clear();
    _liveRetryTimer?.cancel();
    _liveRetryTimer = null;
    _liveSubscriptionKey = null;
  }

  void _scheduleExpiry() {
    _expiryTimer?.cancel();
    _expiryTimer = null;
    if (_isDisposed) return;
    final nowSeconds = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    int? nextExpiryAt;
    for (final entry in _rowsByChannel.entries) {
      final inactivity = state.preferenceFor(entry.key).inactivity;
      final duration = switch (inactivity) {
        ThreadSidebarInactivity.oneDay => 86400,
        ThreadSidebarInactivity.threeDays => 3 * 86400,
        ThreadSidebarInactivity.sevenDays => 7 * 86400,
        ThreadSidebarInactivity.thirtyDays => 30 * 86400,
        ThreadSidebarInactivity.never => null,
      };
      if (duration == null) continue;
      for (final row in entry.value) {
        final expiresAt = row.latestActivityAt + duration + 1;
        if (expiresAt <= nowSeconds) continue;
        if (nextExpiryAt == null || expiresAt < nextExpiryAt) {
          nextExpiryAt = expiresAt;
        }
      }
    }
    if (nextExpiryAt == null) return;
    _expiryTimer = Timer(Duration(seconds: nextExpiryAt - nowSeconds), () {
      if (_isDisposed) return;
      state = ThreadSidebarState(
        isReady: state.isReady,
        isRefreshing: state.isRefreshing,
        preferences: state.preferences,
        rowsByChannel: state.rowsByChannel,
        nextCursorByChannel: state.nextCursorByChannel,
        loadingMoreChannelIds: state.loadingMoreChannelIds,
        error: state.error,
      );
      _scheduleExpiry();
    });
  }

  void _dispose() {
    _isDisposed = true;
    _generation++;
    _requestId++;
    _refreshAfterCurrent = false;
    _refreshScheduled = false;
    _clearLiveSubscription();
    _liveRefreshTimer?.cancel();
    _liveRefreshTimer = null;
    _expiryTimer?.cancel();
    _expiryTimer = null;
  }
}

final threadSidebarProvider =
    NotifierProvider<ThreadSidebarNotifier, ThreadSidebarState>(
      ThreadSidebarNotifier.new,
    );
