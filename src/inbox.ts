import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import { mostUrgentIndicator } from "./statusRollup";

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

/** Threads in the chosen scope; every thread when the scope is null. */
export function filterByProject(
  threads: readonly PluginSidebarThread[],
  projectId: string | null,
): PluginSidebarThread[] {
  if (projectId === null) return [...threads];
  return threads.filter((thread) => thread.projectId === projectId);
}

/** Archived threads, and the hidden helper threads bb's own list leaves out. */
export function visibleInboxThreads(
  threads: readonly PluginSidebarThread[],
): PluginSidebarThread[] {
  return threads.filter((thread) => !thread.isArchived && !thread.isHidden);
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

export interface SubtreeSummary {
  waitingForYou: boolean;
  mostUrgent: PluginSidebarThread | null;
}

export function summarizeSubtrees(
  threads: readonly PluginSidebarThread[],
  isMuted: (thread: PluginSidebarThread) => boolean,
): Map<string, SubtreeSummary> {
  const childrenById = childrenByParentId(threads);
  const summaries = new Map<string, SubtreeSummary>();
  const visiting = new Set<string>();
  const summarize = (thread: PluginSidebarThread): SubtreeSummary => {
    const known = summaries.get(thread.id);
    if (known) return known;
    if (visiting.has(thread.id))
      return { waitingForYou: false, mostUrgent: null };
    visiting.add(thread.id);
    let waitingForYou = false;
    const candidates: PluginSidebarThread[] = [thread];
    for (const child of childrenById.get(thread.id) ?? []) {
      const childSummary = summarize(child);
      if (!isMuted(child)) {
        waitingForYou ||=
          child.hasPendingInteraction || childSummary.waitingForYou;
      }
      candidates.push(childSummary.mostUrgent ?? child);
    }
    const summary = {
      waitingForYou,
      mostUrgent: mostUrgentIndicator(candidates),
    };
    visiting.delete(thread.id);
    summaries.set(thread.id, summary);
    return summary;
  };
  for (const thread of threads) summarize(thread);
  return summaries;
}
