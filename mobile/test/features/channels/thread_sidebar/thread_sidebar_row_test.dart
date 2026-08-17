import 'package:buzz/features/channels/thread_sidebar/thread_sidebar_models.dart';
import 'package:buzz/features/channels/thread_sidebar/thread_sidebar_row.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _root = NostrEvent(
  id: 'root-1',
  pubkey: 'alice',
  createdAt: 100,
  kind: EventKind.streamMessage,
  tags: [
    ['h', 'general'],
  ],
  content: '**A useful** [thread](https://example.com)',
  sig: '',
);

void main() {
  testWidgets(
    'renders an accessible bookmarked thread with both interactions',
    (tester) async {
      var taps = 0;
      var longPresses = 0;
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.light(),
          home: Scaffold(
            body: MobileThreadSidebarRow(
              thread: const ProjectedThreadRow(
                root: _root,
                latestActivityAt: 100,
                latestReplyAt: 100,
                bookmarked: true,
              ),
              isUnread: true,
              onTap: () => taps++,
              onToggleBookmark: () => longPresses++,
            ),
          ),
        ),
      );

      expect(find.text('A useful thread'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('bookmarked-thread-root-1')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('unread-thread-root-1')),
        findsOneWidget,
      );
      expect(
        tester
            .getSize(find.byKey(const ValueKey('channel-thread-root-1')))
            .height,
        greaterThanOrEqualTo(Grid.gutter * 2),
      );

      await tester.tap(find.byKey(const ValueKey('channel-thread-root-1')));
      expect(taps, 1);
      await tester.longPress(
        find.byKey(const ValueKey('channel-thread-root-1')),
      );
      expect(longPresses, 1);
    },
  );
}
