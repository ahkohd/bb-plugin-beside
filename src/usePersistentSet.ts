import { useCallback, useState } from "react";

function readStoredSet<T extends string>(
  key: string,
  fallback: readonly T[],
): ReadonlySet<T> {
  try {
    const stored = globalThis.localStorage?.getItem(key);
    if (stored == null) return new Set(fallback);
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return new Set(fallback);
    return new Set(
      parsed.filter((value): value is T => typeof value === "string"),
    );
  } catch {
    return new Set(fallback);
  }
}

function writeStoredSet(key: string, values: ReadonlySet<string>): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify([...values]));
  } catch {
    return;
  }
}

export function usePersistentSet<T extends string>(
  key: string,
  fallback: readonly T[] = [],
): [ReadonlySet<T>, (value: T) => void] {
  const [values, setValues] = useState(() => readStoredSet(key, fallback));
  const toggle = useCallback(
    (value: T) =>
      setValues((current) => {
        const next = new Set(current);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        writeStoredSet(key, next);
        return next;
      }),
    [key],
  );
  return [values, toggle];
}
