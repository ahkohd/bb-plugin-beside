import type {
  PluginSidebarThread,
  PluginThreadActionTarget,
} from "@get-bb/plugin-sdk/app";

export function toThreadActionTarget(
  thread: PluginSidebarThread,
): PluginThreadActionTarget {
  return {
    id: thread.id,
    projectId: thread.projectId,
    parentThreadId: thread.parentThreadId,
    archivedAt: thread.archivedAt,
    pinnedAt: thread.pinnedAt,
    sectionId: thread.sectionId,
    isUnread: thread.isUnread,
    status: thread.status,
    environment:
      thread.environment?.id == null
        ? null
        : { id: thread.environment.id, path: thread.environment.path },
  };
}
