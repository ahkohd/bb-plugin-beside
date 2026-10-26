import type { PluginSidebarThread } from "@get-bb/plugin-sdk";

/**
 * The sort that defines this sidebar: newest thread on top, and NOTHING moves
 * it afterwards. Activity never re-orders the list, so a row holds its place
 * from creation until you park it and the screen only changes when you act.
 * Status is carried by the card, not by position.
 *
 * Ties break on id so the order is total and stable across renders.
 */
export function sortByCreatedAtDescending<
  T extends { readonly id: string; readonly createdAt: number },
>(threads: readonly T[]): T[] {
  return [...threads].sort(
    (left, right) =>
      right.createdAt - left.createdAt || left.id.localeCompare(right.id),
  );
}

export function threadDisplayTitle(thread: PluginSidebarThread): string {
  const title = thread.title?.trim();
  if (title) return title;
  const fallback = thread.titleFallback?.trim();
  return fallback ? fallback : "Untitled thread";
}

/** Substring match on the visible title only, preserving the incoming order. */
export function searchThreadsByTitle(
  threads: readonly PluginSidebarThread[],
  query: string,
): PluginSidebarThread[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return [...threads];
  return threads.filter((thread) =>
    threadDisplayTitle(thread).toLowerCase().includes(normalized),
  );
}

export interface ProjectScope {
  /** Project id, or null for "all projects". */
  id: string | null;
  name: string;
}

/** Threads in the chosen scope; every thread when the scope is null. */
export function filterByProject(
  threads: readonly PluginSidebarThread[],
  projectId: string | null,
): PluginSidebarThread[] {
  if (projectId === null) return [...threads];
  return threads.filter((thread) => thread.projectId === projectId);
}

/** Archived threads never belong in the inbox. */
export function visibleInboxThreads(
  threads: readonly PluginSidebarThread[],
): PluginSidebarThread[] {
  return threads.filter((thread) => !thread.isArchived);
}

/** Pinned first (they are the user's own ordering), then the static sort. */
function compareCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sortPinned(
  threads: readonly PluginSidebarThread[],
): PluginSidebarThread[] {
  return [...threads].sort((left, right) => {
    if (left.pinSortKey !== null && right.pinSortKey !== null) {
      const bySortKey = compareCodepoint(left.pinSortKey, right.pinSortKey);
      if (bySortKey !== 0) return bySortKey;
    }
    const byPinnedAt = (right.pinnedAt ?? 0) - (left.pinnedAt ?? 0);
    if (byPinnedAt !== 0) return byPinnedAt;
    const byCreatedAt = right.createdAt - left.createdAt;
    if (byCreatedAt !== 0) return byCreatedAt;
    return compareCodepoint(left.id, right.id);
  });
}

/**
 * The top level of the list: child threads nest under their parent instead.
 *
 * A child is only hidden when its parent is actually on screen. An orphan
 * (parent archived, deleted, or filtered out by the project scope) stays in
 * the list, because hiding it would make it unreachable everywhere.
 */
export function hideChildrenOfVisibleParents(
  threads: readonly PluginSidebarThread[],
): PluginSidebarThread[] {
  const visibleIds = new Set(threads.map((thread) => thread.id));
  return threads.filter(
    (thread) =>
      thread.parentThreadId === null || !visibleIds.has(thread.parentThreadId),
  );
}

export function childrenByParentId(
  threads: readonly PluginSidebarThread[],
): Map<string, PluginSidebarThread[]> {
  const byParent = new Map<string, PluginSidebarThread[]>();
  for (const thread of threads) {
    if (thread.parentThreadId === null) continue;
    const siblings = byParent.get(thread.parentThreadId) ?? [];
    siblings.push(thread);
    byParent.set(thread.parentThreadId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((left, right) => left.createdAt - right.createdAt);
  }
  return byParent;
}

export function descendantsOf(
  childrenById: ReadonlyMap<string, readonly PluginSidebarThread[]>,
  threadId: string,
): PluginSidebarThread[] {
  const descendants: PluginSidebarThread[] = [];
  const seen = new Set<string>([threadId]);
  const pending = [...(childrenById.get(threadId) ?? [])];
  while (pending.length > 0) {
    const next = pending.shift()!;
    if (seen.has(next.id)) continue;
    seen.add(next.id);
    descendants.push(next);
    pending.push(...(childrenById.get(next.id) ?? []));
  }
  return descendants;
}
