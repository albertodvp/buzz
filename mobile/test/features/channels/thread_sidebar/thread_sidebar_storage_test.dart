import 'package:buzz/features/channels/thread_sidebar/thread_sidebar_models.dart';
import 'package:buzz/features/channels/thread_sidebar/thread_sidebar_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

Future<SharedPreferences> _prefs([Map<String, Object> values = const {}]) {
  SharedPreferences.setMockInitialValues(values);
  return SharedPreferences.getInstance();
}

void main() {
  test('scopes preferences by relay, community, and identity', () {
    expect(
      threadSidebarPreferencesKey(
        relayUrl: 'WSS://Example.COM/',
        communityId: 'Community-A',
        pubkey: 'PUBKEY-A',
      ),
      'buzz-thread-sidebar-preferences.v1:https://example.com:community-a:pubkey-a',
    );
  });

  test('round-trips the local inactivity preference', () async {
    final storage = ThreadSidebarStorage(await _prefs());
    const key = 'scope';
    await storage.write(
      key,
      const ThreadSidebarPreferences(
        channels: {
          'general': ChannelThreadSidebarPreference(
            inactivity: ThreadSidebarInactivity.sevenDays,
            updatedAt: 12,
          ),
        },
      ),
    );

    final stored = storage.read(key).forChannel('general');
    expect(stored.inactivity, ThreadSidebarInactivity.sevenDays);
    expect(stored.updatedAt, 12);
  });

  test('fails closed for malformed preference payloads', () async {
    final storage = ThreadSidebarStorage(
      await _prefs({'scope': '{"version":1,"channels":[]}'}),
    );
    expect(storage.read('scope').channels, isEmpty);
  });

  test(
    'normalizes in-memory preferences to the persisted 128-channel cap',
    () async {
      final storage = ThreadSidebarStorage(await _prefs());
      final normalized = storage.normalize(
        ThreadSidebarPreferences(
          channels: {
            for (var index = 0; index < 129; index++)
              'channel-$index': ChannelThreadSidebarPreference(
                updatedAt: index,
              ),
          },
        ),
      );

      expect(normalized.channels, hasLength(128));
      expect(normalized.channels, isNot(contains('channel-0')));
      expect(normalized.channels, contains('channel-128'));
    },
  );
}
