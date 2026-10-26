import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

export type ReorderPlacement = "before" | "after";

export interface PinnedReorderRequest {
  threadId: string;
  previousThreadId: string | null;
  nextThreadId: string | null;
}

export interface PinnedRowReorder {
  rowId: string;
  placement: ReorderPlacement | null;
  isDragging: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
}

interface DragState {
  threadId: string;
  insertBefore: number;
}

const DRAG_THRESHOLD_PX = 4;
export const PINNED_ROW_ID_ATTRIBUTE = "data-pinned-row-id";

function insertIndexAt(container: HTMLElement, clientY: number): number {
  const rows = [
    ...container.querySelectorAll<HTMLElement>(`[${PINNED_ROW_ID_ATTRIBUTE}]`),
  ];
  const index = rows.findIndex((row) => {
    const rect = row.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2;
  });
  return index === -1 ? rows.length : index;
}

function isNoOpDrop(order: readonly string[], drag: DragState): boolean {
  const from = order.indexOf(drag.threadId);
  return drag.insertBefore === from || drag.insertBefore === from + 1;
}

export function reorderRequestFor(
  order: readonly string[],
  drag: DragState,
): { nextOrder: string[]; request: PinnedReorderRequest } | null {
  if (!order.includes(drag.threadId) || isNoOpDrop(order, drag)) return null;
  const from = order.indexOf(drag.threadId);
  const remaining = order.filter((id) => id !== drag.threadId);
  const at =
    drag.insertBefore > from ? drag.insertBefore - 1 : drag.insertBefore;
  const nextOrder = [
    ...remaining.slice(0, at),
    drag.threadId,
    ...remaining.slice(at),
  ];
  return {
    nextOrder,
    request: {
      threadId: drag.threadId,
      previousThreadId: nextOrder[at - 1] ?? null,
      nextThreadId: nextOrder[at + 1] ?? null,
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
  const containerRef = useRef<HTMLUListElement | null>(null);
  const suppressNextClick = useRef(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [optimisticOrder, setOptimisticOrder] = useState<
    readonly string[] | null
  >(null);
  const order = useMemo(
    () => applyOptimisticOrder(pinnedIds, optimisticOrder),
    [pinnedIds, optimisticOrder],
  );
  const orderRef = useRef(order);
  orderRef.current = order;
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  const startTracking = useCallback(
    (threadId: string, startX: number, startY: number) => {
      let active = false;
      let latest: DragState | null = null;

      const stop = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        cleanupRef.current = null;
      };
      const cancel = () => {
        stop();
        latest = null;
        setDrag(null);
      };
      const onMove = (event: PointerEvent) => {
        const container = containerRef.current;
        if (!container) return cancel();
        if (!active) {
          if (Math.abs(event.clientY - startY) < DRAG_THRESHOLD_PX) return;
          if (
            Math.abs(event.clientX - startX) > Math.abs(event.clientY - startY)
          ) {
            return stop();
          }
          active = true;
        }
        const bounds = container.getBoundingClientRect();
        if (event.clientX > bounds.right || event.clientX < bounds.left) {
          return cancel();
        }
        latest = {
          threadId,
          insertBefore: insertIndexAt(container, event.clientY),
        };
        setDrag(latest);
      };
      const onUp = () => {
        const finished = latest;
        stop();
        setDrag(null);
        if (!active || finished === null) return;
        suppressNextClick.current = true;
        window.setTimeout(() => {
          suppressNextClick.current = false;
        }, 0);
        const reorder = reorderRequestFor(orderRef.current, finished);
        if (reorder === null) return;
        setOptimisticOrder(reorder.nextOrder);
        void onReorder(reorder.request)
          .catch(() => undefined)
          .finally(() => setOptimisticOrder(null));
      };
      const onCancel = () => cancel();

      cleanupRef.current?.();
      cleanupRef.current = stop;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    },
    [onReorder],
  );

  const rowReorder = useCallback(
    (threadId: string): PinnedRowReorder => {
      const index = order.indexOf(threadId);
      const showsLine = drag !== null && !isNoOpDrop(order, drag);
      const placement: ReorderPlacement | null = !showsLine
        ? null
        : drag.insertBefore === index
          ? "before"
          : drag.insertBefore === order.length && index === order.length - 1
            ? "after"
            : null;
      return {
        rowId: threadId,
        placement,
        isDragging: drag?.threadId === threadId,
        onPointerDown: (event) => {
          if (event.button !== 0 || event.pointerType === "touch") return;
          startTracking(threadId, event.clientX, event.clientY);
        },
      };
    },
    [drag, order, startTracking],
  );

  const onClickCapture = useCallback((event: ReactMouseEvent) => {
    if (!suppressNextClick.current) return;
    suppressNextClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return { containerRef, order, rowReorder, onClickCapture };
}
