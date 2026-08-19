import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../../shared/theme/theme.dart';
import 'thread_sidebar_models.dart';

const _threadRowMinHeight = Grid.gutter * 2;

class MobileThreadSidebarRow extends StatelessWidget {
  const MobileThreadSidebarRow({
    super.key,
    required this.thread,
    required this.isUnread,
    required this.onTap,
  });

  final ProjectedThreadRow thread;
  final bool isUnread;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    key: ValueKey('channel-thread-${thread.root.id}'),
    onTap: onTap,
    child: ConstrainedBox(
      constraints: const BoxConstraints(minHeight: _threadRowMinHeight),
      child: Padding(
        padding: const EdgeInsetsDirectional.only(
          start: Grid.gutter + 28,
          end: Grid.gutter,
          top: Grid.quarter,
          bottom: Grid.quarter,
        ),
        child: Row(
          children: [
            Icon(
              LucideIcons.messageSquareText,
              size: 14,
              color: navigationSecondaryForeground(context),
            ),
            const SizedBox(width: Grid.xxs),
            Expanded(
              child: Text(
                threadSidebarLabel(thread.root.content),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: contentListBodyTextStyle.copyWith(
                  color: navigationSecondaryForeground(context),
                  fontWeight: isUnread ? FontWeight.w700 : null,
                ),
              ),
            ),
            if (isUnread) ...[
              const SizedBox(width: Grid.xxs),
              Tooltip(
                message: 'Unread replies',
                child: Container(
                  key: ValueKey('unread-thread-${thread.root.id}'),
                  width: Grid.half,
                  height: Grid.half,
                  decoration: BoxDecoration(
                    color: context.colors.primary,
                    shape: BoxShape.circle,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    ),
  );
}

String threadSidebarLabel(String content) {
  final normalized = content
      .replaceAll(RegExp(r'!\[[^\]]*\]\([^)]*\)'), '')
      .replaceAllMapped(RegExp(r'\[([^\]]+)\]\([^)]*\)'), (match) => match[1]!)
      .replaceAll(RegExp(r'[*_~`>#]+'), '')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  if (normalized.isEmpty) return 'Media thread';
  final graphemes = normalized.characters;
  return graphemes.length <= 80
      ? normalized
      : '${graphemes.take(79).toString().trimRight()}…';
}
