import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import type { bbSidebarRpcContract } from "./server";
import {
  canPark,
  nextWakeDelayMs,
  resolveShelf,
  type ThreadLifecycleRow,
  type ThreadShelf,
} from "./lifecycle";

const BUSY_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "pending",
  "starting",
  "stopping",
  "provisioning",
  "waiting-for-host",
]);

/** Any live work at all, which blocks parking and wakes a parked thread. */
export function isWorking(thread: PluginSidebarThread): boolean {
  const { activity } = thread;
  return (
    BUSY_STATUSES.has(thread.status) ||
    BUSY_STATUSES.has(thread.runtimeStatus) ||
    thread.queuedWork === "waiting" ||
    activity.workflows > 0 ||
    activity.backgroundAgents > 0 ||
    activity.backgroundCommands > 0 ||
    activity.planMode > 0 ||
    activity.goals > 0 ||
    thread.indicator === "runtime" ||
    thread.indicator === "working-draft"
  );
}

const LOCAL_CACHE_KEY = "bb-sidebar:lifecycle";

function readCachedRows(): ThreadLifecycleRow[] | null {
  try {
    const stored = globalThis.localStorage?.getItem(LOCAL_CACHE_KEY);
    if (stored == null) return null;
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as ThreadLifecycleRow[]) : null;
  } catch {
    return null;
  }
}

function writeCachedRows(rows: readonly ThreadLifecycleRow[]): void {
  try {
    globalThis.localStorage?.setItem(LOCAL_CACHE_KEY, JSON.stringify(rows));
  } catch {
    return;
  }
}

export interface LifecycleApi {
  isReady: boolean;
  shelfFor(thread: PluginSidebarThread): ThreadShelf;
  canPark(thread: PluginSidebarThread): boolean;
  wakeAtFor(thread: PluginSidebarThread): number | null;
  settle(threadId: string): void;
  unsettle(threadId: string): void;
  snooze(threadId: string, snoozedUntil: number): void;
  unsnooze(threadId: string): void;
}

/**
 * Reads the plugin's own lifecycle store and classifies threads onto shelves.
 *
 * `now` is state, not a render-time clock read: a snooze that elapses must
 * move its row without waiting for an unrelated re-render, and re-reading the
 * clock during render would make the classification unstable.
 */
export function useLifecycle(
  threads: readonly PluginSidebarThread[],
): LifecycleApi {
  const rpc = useRpc<typeof bbSidebarRpcContract>();
  const [cachedRows] = useState(readCachedRows);
  const [rows, setRows] = useState<ReadonlyMap<string, ThreadLifecycleRow>>(
    () => new Map((cachedRows ?? []).map((row) => [row.threadId, row])),
  );
  const [isReady, setIsReady] = useState(cachedRows !== null);
  const [now, setNow] = useState(() => Date.now());

  // Responses can land out of order (a mutation's refresh racing a realtime
  // one), and an older list would silently restore state the user just
  // changed. Only the newest request may write.
  const requestSeq = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++requestSeq.current;
    const result = await rpc.call("listLifecycle", {});
    if (seq !== requestSeq.current) return;
    writeCachedRows(result.rows);
    setRows(new Map(result.rows.map((row) => [row.threadId, row])));
    setIsReady(true);
  }, [rpc]);

  useEffect(() => {
    void refresh().catch(() => setIsReady(true));
  }, [refresh]);

  useRealtime("lifecycle", () => {
    void refresh();
  });

  // Arm one timer for the soonest wake instead of polling: the shelf empties
  // the moment a snooze expires, and nothing ticks while nothing is snoozed.
  useEffect(() => {
    // Read a fresh clock here rather than trusting `now`: `now` is only
    // updated when a timer fires, so arming from it after a long idle period
    // would schedule a new snooze far too late.
    const armedAt = Date.now();
    const delay = nextWakeDelayMs(
      [...rows.values()].flatMap((row) =>
        row.snoozedUntil === null ? [] : [row.snoozedUntil],
      ),
      armedAt,
    );
    if (delay === null) return;
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [now, rows]);

  return useMemo<LifecycleApi>(() => {
    const signalsFor = (thread: PluginSidebarThread) => ({
      hasPendingInteraction: thread.hasPendingInteraction,
      isWorking: isWorking(thread),
      isUnread: thread.isUnread,
      latestAttentionAt: thread.latestAttentionAt,
    });
    // One read per mutation: the write publishes on the realtime channel, and
    // that subscription already triggers a refresh for every client.
    const mutate = async (
      method: "settle" | "unsettle" | "unsnooze",
      threadId: string,
    ) => {
      await rpc.call(method, { threadId });
    };
    return {
      isReady,
      shelfFor: (thread) =>
        resolveShelf(rows.get(thread.id), signalsFor(thread), now),
      canPark: (thread) => canPark(signalsFor(thread)),
      wakeAtFor: (thread) => rows.get(thread.id)?.snoozedUntil ?? null,
      settle: (threadId) => void mutate("settle", threadId),
      unsettle: (threadId) => void mutate("unsettle", threadId),
      unsnooze: (threadId) => void mutate("unsnooze", threadId),
      snooze: (threadId, snoozedUntil) => {
        void rpc.call("snooze", { threadId, snoozedUntil });
      },
    };
  }, [isReady, now, refresh, rows, rpc]);
}
