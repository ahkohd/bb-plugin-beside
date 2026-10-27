import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
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

const CATCH_UP_TIMEOUT_MS = 5000;

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

export function usePinnedReorder(
  pinnedIds: readonly string[],
  onReorder: (request: PinnedReorderRequest) => Promise<unknown>,
) {
  const [optimisticOrder, setOptimisticOrder] = useState<
    readonly string[] | null
  >(null);
  const latestDrag = useRef(0);
  const order = useMemo(
    () => applyOptimisticOrder(pinnedIds, optimisticOrder),
    [pinnedIds, optimisticOrder],
  );

  useEffect(() => {
    if (optimisticOrder !== null && sameOrder(pinnedIds, optimisticOrder)) {
      setOptimisticOrder(null);
    }
  }, [pinnedIds, optimisticOrder]);

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
      const drag = ++latestDrag.current;
      const clearIfLatest = () => {
        if (drag === latestDrag.current) setOptimisticOrder(null);
      };
      flushSync(() => setOptimisticOrder(reorder.nextOrder));
      void onReorder(reorder.request).then(
        () => setTimeout(clearIfLatest, CATCH_UP_TIMEOUT_MS),
        () => {
          clearIfLatest();
          toast.error("Could not reorder pinned threads");
        },
      );
    },
    [onReorder, order],
  );

  return { order, handleDragEnd };
}
