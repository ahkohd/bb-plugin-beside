import { useEffect, useMemo, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { isDecisionModeOn, useDecisionConfig } from "./useDecisionConfig";
import { toast } from "sonner";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import type { bbSidebarRpcContract } from "./server";
import {
  canPark,
  hasQuietNews,
  nextWakeDelayMs,
  resolveShelf,
  VERDICT_GRACE_MS,
  verdictDeadline,
  type ThreadActivitySignals,
  type ThreadLifecycleRow,
  type ThreadShelf,
} from "./lifecycle";
import {
  applyLocally,
  refreshLifecycle,
  useLifecycleRows,
  type LifecycleRows,
} from "./lifecycleStore";

const WORKING_INDICATORS: ReadonlySet<string> = new Set([
  "runtime",
  "workflow",
  "background-agent",
  "plan-mode",
  "goal",
  "working-draft",
]);

const SETTLED_STATUSES: ReadonlySet<string> = new Set(["idle", "error"]);

export function isIdleApartFromBackgroundCommands(
  thread: PluginSidebarThread,
): boolean {
  const { activity } = thread;
  return (
    !thread.hasPendingInteraction &&
    SETTLED_STATUSES.has(thread.status) &&
    SETTLED_STATUSES.has(thread.runtimeStatus) &&
    thread.queuedWork !== "waiting" &&
    !WORKING_INDICATORS.has(thread.indicator) &&
    activity.backgroundAgents === 0 &&
    activity.workflows === 0 &&
    activity.planMode === 0 &&
    activity.goals === 0
  );
}

export interface LifecycleSnapshotEntry {
  threadId: string;
  row: {
    settledAt: number | null;
    snoozedUntil: number | null;
    snoozedAt: number | null;
    mutedAt: number | null;
  } | null;
}

export interface LifecycleApi {
  isReady: boolean;
  snapshot(threadIds: readonly string[]): LifecycleSnapshotEntry[];
  snapshotAll(): LifecycleSnapshotEntry[];
  settleMany(threadIds: readonly string[]): Promise<unknown>;
  snoozeMany(
    threadIds: readonly string[],
    snoozedUntil: number,
  ): Promise<unknown>;
  restore(entries: readonly LifecycleSnapshotEntry[]): Promise<unknown>;
  shelfFor(thread: PluginSidebarThread): ThreadShelf;
  hasQuietNews(thread: PluginSidebarThread): boolean;
  canPark(thread: PluginSidebarThread): boolean;
  wakeAtFor(thread: PluginSidebarThread): number | null;
  settle(threadId: string): void;
  unsettle(threadId: string): void;
  snooze(threadId: string, snoozedUntil: number): void;
  unsnooze(threadId: string): void;
}

const MAX_IDS_PER_CALL = 1000;

function chunks<T>(items: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += MAX_IDS_PER_CALL) {
    result.push(items.slice(start, start + MAX_IDS_PER_CALL));
  }
  return result;
}

function signalsFor(thread: PluginSidebarThread): ThreadActivitySignals {
  return {
    hasPendingInteraction: thread.hasPendingInteraction,
    isUnread: thread.isUnread,
    latestAttentionAt: thread.latestAttentionAt,
    awaitsVerdict: thread.status === "idle",
  };
}

function wakeTimes(
  rows: LifecycleRows,
  threads: readonly PluginSidebarThread[],
  now: number,
  verdictGraceMs: number,
): number[] {
  const snoozeWakes = [...rows.values()].flatMap((row) =>
    row.snoozedUntil === null ? [] : [row.snoozedUntil],
  );
  if (verdictGraceMs === 0) return snoozeWakes;
  const verdictDeadlines = threads.flatMap((thread) => {
    const deadline = verdictDeadline(rows.get(thread.id), signalsFor(thread), now, {
      verdictGraceMs,
    });
    return deadline === null ? [] : [deadline];
  });
  return [...snoozeWakes, ...verdictDeadlines];
}

export function useDecisionModeEnabled(): boolean {
  return isDecisionModeOn(useDecisionConfig().config);
}

export function useLifecycle(
  threads: readonly PluginSidebarThread[] = [],
): LifecycleApi {
  const rpc = useRpc<typeof bbSidebarRpcContract>();
  const storedRows = useLifecycleRows(rpc);
  const rows = useMemo<LifecycleRows>(
    () => storedRows ?? new Map(),
    [storedRows],
  );
  const isReady = storedRows !== null;
  const [now, setNow] = useState(() => Date.now());
  const verdictGraceMs = useDecisionModeEnabled() ? VERDICT_GRACE_MS : 0;

  useEffect(() => {
    const armedAt = Date.now();
    const wakes = wakeTimes(rows, threads, now, verdictGraceMs);
    if (wakes.some((wake) => wake > now && wake <= armedAt)) {
      setNow(armedAt);
      return;
    }
    const delay = nextWakeDelayMs(wakes, armedAt);
    if (delay === null) return;
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [now, rows, threads, verdictGraceMs]);

  useEffect(() => {
    const catchUp = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    document.addEventListener("visibilitychange", catchUp);
    return () => document.removeEventListener("visibilitychange", catchUp);
  }, []);

  return useMemo<LifecycleApi>(() => {
    const reportFailure = (message: string) => {
      toast.error(message);
      void refreshLifecycle(rpc).catch(() => undefined);
    };
    const change = (
      threadId: string,
      row: ThreadLifecycleRow | null,
      send: () => Promise<unknown>,
      failure: string,
    ) => {
      applyLocally([{ threadId, row }]);
      void send().catch(() => reportFailure(failure));
    };
    const parked = (
      threadId: string,
      fields: Partial<ThreadLifecycleRow>,
    ): ThreadLifecycleRow => ({
      threadId,
      settledAt: null,
      snoozedUntil: null,
      snoozedAt: null,
      mutedAt: null,
      ...fields,
    });
    const inChunks = async (
      threadIds: readonly string[],
      send: (chunk: string[]) => Promise<unknown>,
    ) => {
      for (const chunk of chunks(threadIds)) await send(chunk);
      await refreshLifecycle(rpc).catch(() => undefined);
    };
    return {
      isReady,
      snapshot: (threadIds) =>
        threadIds.map((threadId) => {
          const row = rows.get(threadId);
          return {
            threadId,
            row: row
              ? {
                  settledAt: row.settledAt,
                  snoozedUntil: row.snoozedUntil,
                  snoozedAt: row.snoozedAt,
                  mutedAt: row.mutedAt ?? null,
                }
              : null,
          };
        }),
      snapshotAll: () =>
        [...rows.values()].map((row) => ({
          threadId: row.threadId,
          row: {
            settledAt: row.settledAt,
            snoozedUntil: row.snoozedUntil,
            snoozedAt: row.snoozedAt,
            mutedAt: row.mutedAt ?? null,
          },
        })),
      settleMany: (threadIds) =>
        inChunks(threadIds, (chunk) =>
          rpc.call("settleMany", { threadIds: chunk }),
        ),
      snoozeMany: (threadIds, snoozedUntil) =>
        inChunks(threadIds, (chunk) =>
          rpc.call("snoozeMany", { threadIds: chunk, snoozedUntil }),
        ),
      restore: async (entries) => {
        for (const chunk of chunks(entries)) {
          await rpc.call("restoreLifecycle", { entries: chunk });
        }
        await refreshLifecycle(rpc).catch(() => undefined);
      },
      shelfFor: (thread) =>
        resolveShelf(rows.get(thread.id), signalsFor(thread), now, {
          verdictGraceMs,
        }),
      hasQuietNews: (thread) =>
        thread.isUnread && hasQuietNews(rows.get(thread.id), signalsFor(thread)),
      canPark: (thread) => canPark(signalsFor(thread)),
      wakeAtFor: (thread) => rows.get(thread.id)?.snoozedUntil ?? null,
      settle: (threadId) =>
        change(
          threadId,
          parked(threadId, { settledAt: Date.now() }),
          () => rpc.call("settle", { threadId }),
          "Could not settle the thread",
        ),
      unsettle: (threadId) =>
        change(
          threadId,
          null,
          () => rpc.call("unsettle", { threadId }),
          "Could not move the thread back",
        ),
      unsnooze: (threadId) =>
        change(
          threadId,
          null,
          () => rpc.call("unsnooze", { threadId }),
          "Could not wake the thread",
        ),
      snooze: (threadId, snoozedUntil) =>
        change(
          threadId,
          parked(threadId, { snoozedUntil, snoozedAt: Date.now() }),
          () => rpc.call("snooze", { threadId, snoozedUntil }),
          "Could not snooze the thread",
        ),
    };
  }, [isReady, now, rows, rpc, verdictGraceMs]);
}
