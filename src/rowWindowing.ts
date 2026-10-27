import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

export const WINDOWING_THRESHOLD = 150;
const VIEWPORT_MARGIN_PX = 400;

export interface RowWindowing {
  isRealized(threadId: string): boolean;
  register(threadId: string): (element: HTMLElement | null) => void;
}

export const RowWindowingContext = createContext<RowWindowing | null>(null);

export function useRowWindowing(): RowWindowing | null {
  return useContext(RowWindowingContext);
}

export function useRowWindowingController(
  rootRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): RowWindowing | null {
  const supported = typeof IntersectionObserver !== "undefined";
  const active = enabled && supported;
  const [realized, setRealized] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const observerRef = useRef<IntersectionObserver | null>(null);
  const elementsRef = useRef(new Map<string, HTMLElement>());
  const keysRef = useRef(new Map<Element, string>());
  const callbacksRef = useRef(
    new Map<string, (element: HTMLElement | null) => void>(),
  );

  useEffect(() => {
    if (!active) return;
    const root = rootRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entering: string[] = [];
        const leaving: string[] = [];
        for (const entry of entries) {
          const key = keysRef.current.get(entry.target);
          if (key === undefined) continue;
          (entry.isIntersecting ? entering : leaving).push(key);
        }
        if (entering.length === 0 && leaving.length === 0) return;
        startTransition(() =>
          setRealized((previous) => {
            const next = new Set(previous);
            for (const key of leaving) next.delete(key);
            for (const key of entering) next.add(key);
            return next;
          }),
        );
      },
      { root, rootMargin: `${VIEWPORT_MARGIN_PX}px 0px` },
    );
    observerRef.current = observer;
    for (const element of elementsRef.current.values()) {
      observer.observe(element);
    }
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [active, rootRef]);

  const register = useCallback((threadId: string) => {
    let callback = callbacksRef.current.get(threadId);
    if (!callback) {
      callback = (element: HTMLElement | null) => {
        const previous = elementsRef.current.get(threadId);
        if (previous && previous !== element) {
          observerRef.current?.unobserve(previous);
          keysRef.current.delete(previous);
          elementsRef.current.delete(threadId);
        }
        if (element) {
          elementsRef.current.set(threadId, element);
          keysRef.current.set(element, threadId);
          observerRef.current?.observe(element);
        }
      };
      callbacksRef.current.set(threadId, callback);
    }
    return callback;
  }, []);

  return useMemo(
    () =>
      active
        ? { isRealized: (threadId: string) => realized.has(threadId), register }
        : null,
    [active, realized, register],
  );
}
