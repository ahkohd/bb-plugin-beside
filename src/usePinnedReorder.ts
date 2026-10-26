import { useCallback, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { arrayMove } from "@dnd-kit/sortable";
import type { DragEndEvent } from "@dnd-kit/core";

export interface PinnedReorderRequest {
  threadId: string;
  previousThreadId: string | null;
  nextThreadId: string | null;
}

export function reorderRequestFor(
  order: readonly string[],
  activeId: string,
  overId: string,
): { nextOrder: string[]; request: PinnedReorderRequest } | null {
  const from = order.indexOf(activeId);
  const to = order.indexOf(overId);
  if (from === -1 || to === -1 || from === to) return null;
  const nextOrder = arrayMove([...order], from, to);
  return {
    nextOrder,
    request: {
      threadId: activeId,
      previousThreadId: nextOrder[to - 1] ?? null,
      nextThreadId: nextOrder[to + 1] ?? null,
    },
  };
}

function applyOptimisticOrder(
  ids: readonly string[],
  optimistic: readonly string[] | null,
): readonly string[] {
  if (optimistic === null) return ids;
  const sameMembers =
    optimistic.length === ids.length &&
    optimistic.every((id) => ids.includes(id));
  return sameMembers ? optimistic : ids;
}

export function usePinnedReorder(
  pinnedIds: readonly string[],
  onReorder: (request: PinnedReorderRequest) => Promise<unknown>,
) {
  const [optimisticOrder, setOptimisticOrder] = useState<
    readonly string[] | null
  >(null);
  const order = useMemo(
    () => applyOptimisticOrder(pinnedIds, optimisticOrder),
    [pinnedIds, optimisticOrder],
  );

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      if (
        !over ||
        typeof active.id !== "string" ||
        typeof over.id !== "string"
      ) {
        return;
      }
      const reorder = reorderRequestFor(order, active.id, over.id);
      if (reorder === null) return;
      flushSync(() => setOptimisticOrder(reorder.nextOrder));
      void onReorder(reorder.request)
        .catch(() => undefined)
        .finally(() => setOptimisticOrder(null));
    },
    [onReorder, order],
  );

  return { order, handleDragEnd };
}
