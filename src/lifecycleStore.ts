import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  useRealtime,
  useRealtimeConnectionState,
  type PluginRpcClient,
} from "@get-bb/plugin-sdk/app";
import type { bbSidebarRpcContract } from "./server";
import type { ThreadLifecycleRow } from "./lifecycle";

type LifecycleRpc = PluginRpcClient<typeof bbSidebarRpcContract>;
export type LifecycleRows = ReadonlyMap<string, ThreadLifecycleRow>;

const LOCAL_CACHE_KEY = "beside:lifecycle";
export const LIFECYCLE_CHANNEL = "lifecycle";

let rows: LifecycleRows | null | undefined;
let inFlight: Promise<void> | null = null;
let refreshAgain = false;
const listeners = new Set<() => void>();

function readCachedRows(): LifecycleRows | null {
  try {
    const stored = globalThis.localStorage?.getItem(LOCAL_CACHE_KEY);
    if (stored == null) return null;
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return null;
    return new Map(
      (parsed as ThreadLifecycleRow[]).map((row) => [row.threadId, row]),
    );
  } catch {
    return null;
  }
}

function writeCachedRows(next: LifecycleRows): void {
  try {
    globalThis.localStorage?.setItem(
      LOCAL_CACHE_KEY,
      JSON.stringify([...next.values()]),
    );
  } catch {
    return;
  }
}

function currentRows(): LifecycleRows | null {
  if (rows === undefined) rows = readCachedRows();
  return rows;
}

function publish(next: LifecycleRows): void {
  rows = next;
  writeCachedRows(next);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function refreshLifecycle(rpc: LifecycleRpc): Promise<void> {
  if (inFlight !== null) {
    refreshAgain = true;
    return inFlight;
  }
  inFlight = (async () => {
    do {
      refreshAgain = false;
      const result = await rpc.call("listLifecycle", {});
      publish(new Map(result.rows.map((row) => [row.threadId, row])));
    } while (refreshAgain);
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export function applyLocally(
  changes: readonly { threadId: string; row: ThreadLifecycleRow | null }[],
): void {
  const next = new Map(currentRows() ?? []);
  for (const { threadId, row } of changes) {
    if (row === null) next.delete(threadId);
    else next.set(threadId, row);
  }
  publish(next);
}

export function resetLifecycleStoreForTests(): void {
  rows = undefined;
  inFlight = null;
  refreshAgain = false;
}

export function useLifecycleRows(rpc: LifecycleRpc): LifecycleRows | null {
  const snapshot = useSyncExternalStore(subscribe, currentRows, currentRows);
  const connection = useRealtimeConnectionState();
  const wasConnected = useRef(connection === "connected");

  useEffect(() => {
    void refreshLifecycle(rpc).catch(() => {
      if (currentRows() === null) publish(new Map());
    });
  }, [rpc]);

  useEffect(() => {
    const connected = connection === "connected";
    if (connected && !wasConnected.current) {
      void refreshLifecycle(rpc).catch(() => undefined);
    }
    wasConnected.current = connected;
  }, [connection, rpc]);

  useRealtime(LIFECYCLE_CHANNEL, () => {
    void refreshLifecycle(rpc).catch(() => undefined);
  });

  return snapshot;
}
