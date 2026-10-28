import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { cn } from "./lib/utils";

export const CompactViewportContext = createContext(false);

interface RenameSession {
  draft: string;
  saving: boolean;
  error: string | null;
}

const EMPTY_NAME_ERROR = "Name cannot be empty.";
const SAVE_FAILED_ERROR = "Could not save the name. Try again.";

function stopEvent(event: SyntheticEvent) {
  event.stopPropagation();
}

function swallowEvent(event: SyntheticEvent) {
  event.preventDefault();
  event.stopPropagation();
}

export function useInlineRename(threadId: string, currentName: string) {
  const sdk = useSdk();
  const isCompact = useContext(CompactViewportContext);
  const [session, setSession] = useState<RenameSession | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const startsWhenMenuCloses = useRef(false);

  const start = useCallback(() => {
    setSession({ draft: currentName, saving: false, error: null });
  }, [currentName]);

  const startFromDoubleClick = useCallback(() => {
    if (isCompact) return;
    start();
  }, [isCompact, start]);

  const startWhenMenuCloses = useCallback(() => {
    startsWhenMenuCloses.current = true;
  }, []);

  const onMenuCloseAutoFocus = useCallback(
    (event: Event) => {
      if (!startsWhenMenuCloses.current) return;
      startsWhenMenuCloses.current = false;
      event.preventDefault();
      start();
    },
    [start],
  );

  const change = useCallback((draft: string) => {
    setSession((current) =>
      current === null || current.saving
        ? current
        : { ...current, draft, error: null },
    );
  }, []);

  const cancel = useCallback(() => {
    if (sessionRef.current?.saving) return;
    setSession(null);
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    const current = sessionRef.current;
    if (current === null) return true;
    if (current.saving) return false;
    const title = current.draft.trim();
    if (title === "") {
      setSession({ ...current, error: EMPTY_NAME_ERROR });
      return false;
    }
    if (title === currentName.trim()) {
      setSession(null);
      return true;
    }
    setSession({ ...current, saving: true, error: null });
    try {
      await sdk.threads.update({ threadId, title });
      setSession(null);
      return true;
    } catch {
      setSession({ ...current, saving: false, error: SAVE_FAILED_ERROR });
      return false;
    }
  }, [currentName, sdk, threadId]);

  return {
    session,
    isEditing: session !== null,
    start,
    startFromDoubleClick,
    menuRequestRename: isCompact ? undefined : startWhenMenuCloses,
    onMenuCloseAutoFocus,
    change,
    cancel,
    save,
  };
}

export type InlineRename = ReturnType<typeof useInlineRename>;

export function RenameEditor({
  rename,
  label,
  anchor,
}: {
  rename: InlineRename;
  label: string;
  anchor: () => HTMLElement | null;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<HTMLSpanElement | null>(null);
  const settling = useRef(true);
  const composing = useRef(false);
  const session = rename.session;

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.select();
      settling.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  if (session === null) return null;

  const refocusRow = () => {
    const target = anchor();
    requestAnimationFrame(() => {
      if (!target?.isConnected) return;
      const focusIsLost =
        document.activeElement === document.body ||
        editorRef.current?.contains(document.activeElement);
      if (focusIsLost) target.focus({ preventScroll: true });
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || composing.current) return;
    if (event.key === "Escape") {
      event.preventDefault();
      rename.cancel();
      refocusRow();
    } else if (event.key === "Enter" && event.target === inputRef.current) {
      event.preventDefault();
      void rename.save().then((saved) => {
        if (saved) refocusRow();
      });
    }
  };

  return (
    <span
      ref={editorRef}
      data-sidebar-rename-editor=""
      aria-busy={session.saving}
      className="pointer-events-auto relative z-50 flex min-w-0 flex-1 items-center gap-1"
      onBlur={(event) => {
        if (settling.current) return;
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
          return;
        }
        if (!session.saving) void rename.save();
      }}
      onClick={swallowEvent}
      onDoubleClick={swallowEvent}
      onPointerDown={stopEvent}
      onPointerUp={stopEvent}
      onContextMenu={stopEvent}
      onDragStart={swallowEvent}
      onKeyUp={stopEvent}
      onKeyDown={onKeyDown}
    >
      <input
        ref={inputRef}
        aria-label={label}
        aria-invalid={session.error !== null}
        autoCapitalize="sentences"
        autoCorrect="off"
        spellCheck={false}
        value={session.draft}
        readOnly={session.saving}
        onChange={(event) => rename.change(event.target.value)}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        className={cn(
          "min-w-0 flex-1 appearance-none border-0 bg-transparent px-0 py-0 [font:inherit] outline-none",
          session.saving && "animate-shine motion-reduce:opacity-60",
        )}
      />
      {session.saving ? (
        <span role="status" className="sr-only">
          Saving name
        </span>
      ) : null}
      {session.error ? (
        <span
          role="alert"
          className="absolute left-0 top-full z-50 mt-1 w-full min-w-40 whitespace-normal rounded-md border border-border bg-popover px-2 py-1 text-xs text-destructive shadow-md"
        >
          {session.error}
        </span>
      ) : null}
    </span>
  );
}
