part of '../message_actions.dart';

class _BookmarkThreadTile extends ConsumerWidget {
  const _BookmarkThreadTile({required this.message, required this.channelId});

  final TimelineMessage message;
  final String channelId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rootId = message.rootId ?? message.id;
    final bookmarked = ref.watch(
      threadSidebarProvider.select(
        (state) => state.isBookmarked(channelId, rootId),
      ),
    );
    return ListTile(
      key: ValueKey('bookmark-thread-$rootId'),
      contentPadding: EdgeInsets.zero,
      leading: Icon(bookmarked ? LucideIcons.bookmarkX : LucideIcons.bookmark),
      title: Text(bookmarked ? 'Remove bookmark' : 'Bookmark thread'),
      onTap: () {
        Navigator.of(context).pop();
        unawaited(
          ref
              .read(threadSidebarProvider.notifier)
              .toggleBookmark(channelId, rootId),
        );
      },
    );
  }
}
