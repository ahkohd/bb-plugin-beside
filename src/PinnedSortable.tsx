import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const SORTABLE_TRANSITION = {
  duration: 160,
  easing: "cubic-bezier(0.2, 0, 0, 1)",
};

const CLICK_SUPPRESSION_MS = 350;

const reorderCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
};

const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});

const MODIFIERS = [restrictToVerticalAxis];

function setSidebarDraggingCursor(active: boolean): void {
  if (active) document.body.dataset.sidebarDragging = "true";
  else delete document.body.dataset.sidebarDragging;
}

function useDragClickSuppression() {
  const suppressing = useRef(false);
  const timeout = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timeout.current !== null) window.clearTimeout(timeout.current);
    timeout.current = null;
  }, []);

  const begin = useCallback(() => {
    clearTimer();
    suppressing.current = true;
  }, [clearTimer]);

  const endSoon = useCallback(() => {
    clearTimer();
    timeout.current = window.setTimeout(() => {
      timeout.current = null;
      suppressing.current = false;
    }, CLICK_SUPPRESSION_MS);
  }, [clearTimer]);

  useEffect(() => {
    const swallowClickAfterDrag = (event: MouseEvent) => {
      if (!suppressing.current) return;
      clearTimer();
      suppressing.current = false;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    document.addEventListener("click", swallowClickAfterDrag, true);
    return () => {
      document.removeEventListener("click", swallowClickAfterDrag, true);
      clearTimer();
    };
  }, [clearTimer]);

  return { begin, endSoon };
}

export function PinnedSortableList({
  ids,
  disabled,
  onDragEnd,
  children,
}: {
  ids: readonly string[];
  disabled: boolean;
  onDragEnd: (event: DragEndEvent) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const clickSuppression = useDragClickSuppression();

  useEffect(() => () => setSidebarDraggingCursor(false), []);

  return (
    <DndContext
      sensors={disabled ? undefined : sensors}
      collisionDetection={reorderCollisionDetection}
      modifiers={MODIFIERS}
      onDragStart={() => {
        setSidebarDraggingCursor(true);
        clickSuppression.begin();
      }}
      onDragCancel={() => {
        setSidebarDraggingCursor(false);
        clickSuppression.endSoon();
      }}
      onDragEnd={(event) => {
        setSidebarDraggingCursor(false);
        clickSuppression.endSoon();
        onDragEnd(event);
      }}
    >
      <SortableContext
        items={[...ids]}
        strategy={verticalListSortingStrategy}
        disabled={disabled}
      >
        {children}
      </SortableContext>
    </DndContext>
  );
}

export interface PinnedDragBindings {
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  setActivatorNodeRef: (element: HTMLElement | null) => void;
  isDragging: boolean;
}

export function SortablePinnedItem({
  id,
  children,
}: {
  id: string;
  children: (dragBindings: PinnedDragBindings) => ReactNode;
}) {
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id, transition: SORTABLE_TRANSITION });
  const style = useMemo<CSSProperties>(
    () => ({
      transform: CSS.Translate.toString(transform),
      transition,
      position: isDragging ? "relative" : undefined,
      zIndex: isDragging ? 100 : undefined,
      opacity: isDragging ? 0.8 : undefined,
    }),
    [isDragging, transform, transition],
  );
  const dragBindings = useMemo<PinnedDragBindings>(
    () => ({ attributes, listeners, setActivatorNodeRef, isDragging }),
    [attributes, listeners, setActivatorNodeRef, isDragging],
  );

  return (
    <li role="none" ref={setNodeRef} style={style} className="list-none">
      <ul role="none" className="flex flex-col gap-px">
        {children(dragBindings)}
      </ul>
    </li>
  );
}
