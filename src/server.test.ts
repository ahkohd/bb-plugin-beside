import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import plugin from "./server";

type Handler = (input: unknown) => Promise<unknown>;

interface FakeThread {
  archivedAt: number | null;
  pinnedAt: number | null;
  latestAttentionAt: number;
  status: string;
  queuedMessageCount: number;
}

function startServer(threads: Record<string, FakeThread> = {}) {
  const schedules = new Map<string, () => Promise<void> | void>();
  const archivedCalls: string[] = [];
  const db = new DatabaseSync(":memory:");
  const handlers = new Map<string, Handler>();
  const eventHandlers = new Map<string, (payload: unknown) => void>();
  const published: string[] = [];
  const bb = {
    storage: {
      database: () =>
        Object.assign(db, {
          transaction:
            (fn: (...args: unknown[]) => void) =>
            (...args: unknown[]) => {
              db.exec("BEGIN");
              try {
                fn(...args);
                db.exec("COMMIT");
              } catch (error) {
                db.exec("ROLLBACK");
                throw error;
              }
            },
        }),
      migrate: (_db: DatabaseSync, migrations: string[]) => {
        for (const sql of migrations) db.exec(sql);
      },
    },
    realtime: { publish: (channel: string) => published.push(channel) },
    rpc: {
      register: (_contract: unknown, impl: Record<string, Handler>) => {
        for (const [name, fn] of Object.entries(impl)) handlers.set(name, fn);
      },
    },
    background: {
      schedule: (name: string, _cron: string, fn: () => Promise<void> | void) =>
        schedules.set(name, fn),
    },
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) => {
          const thread = threads[threadId];
          if (!thread) throw new Error("not found");
          return { id: threadId, ...thread };
        },
        archive: async ({ threadId }: { threadId: string }) => {
          archivedCalls.push(threadId);
          threads[threadId]!.archivedAt = Date.now();
          return { ok: true, archivedThreadIds: [threadId] };
        },
      },
    },
    events: {
      on: (event: string, fn: (payload: unknown) => void) =>
        eventHandlers.set(event, fn),
    },
  } as unknown as BbPluginApi;
  plugin(bb);
  return {
    call: (method: string, input: unknown = {}) => handlers.get(method)!(input),
    emit: (event: string, payload: unknown) =>
      eventHandlers.get(event)!(payload),
    published,
    archivedCalls,
    runSchedule: (name: string) => schedules.get(name)!(),
  };
}

describe("layout store", () => {
  it("reports no saved layout before anything is stored", async () => {
    const server = startServer();
    expect(await server.call("getLayout")).toEqual({
      collapsedShelves: null,
      expandedParents: null,
    });
  });

  it("adds and removes one item without touching the rest", async () => {
    const server = startServer();
    await server.call("replaceLayoutSet", {
      set: "collapsedShelves",
      items: ["snoozed", "settled"],
    });
    await server.call("setLayoutMember", {
      set: "collapsedShelves",
      item: "inbox",
      member: true,
    });
    await server.call("setLayoutMember", {
      set: "collapsedShelves",
      item: "snoozed",
      member: false,
    });
    expect(await server.call("getLayout")).toEqual({
      collapsedShelves: ["settled", "inbox"],
      expandedParents: null,
    });
  });

  it("tells every open sidebar when the layout changes", async () => {
    const server = startServer();
    await server.call("setLayoutMember", {
      set: "expandedParents",
      item: "thr_a",
      member: true,
    });
    expect(server.published).toContain("layout");
  });

  it("forgets an opened parent when its thread is deleted", async () => {
    const server = startServer();
    await server.call("replaceLayoutSet", {
      set: "expandedParents",
      items: ["thr_gone", "thr_kept"],
    });
    server.emit("thread.deleted", { thread: { id: "thr_gone" } });
    expect(await server.call("getLayout")).toMatchObject({
      expandedParents: ["thr_kept"],
    });
  });
});

describe("muting", () => {
  it("stores a mute and clears it on unmute", async () => {
    const server = startServer();
    await server.call("settle", { threadId: "thr_a" });
    await server.call("mute", { threadId: "thr_a" });
    const muted = (await server.call("listLifecycle")) as {
      rows: {
        threadId: string;
        settledAt: number | null;
        mutedAt: number | null;
      }[];
    };
    expect(muted.rows).toHaveLength(1);
    expect(muted.rows[0]!.settledAt).toBeNull();
    expect(muted.rows[0]!.mutedAt).toEqual(expect.any(Number));

    await server.call("unmute", { threadId: "thr_a" });
    expect(await server.call("listLifecycle")).toEqual({ rows: [] });
  });

  it("settling a muted thread replaces the mute", async () => {
    const server = startServer();
    await server.call("mute", { threadId: "thr_a" });
    await server.call("settle", { threadId: "thr_a" });
    const { rows } = (await server.call("listLifecycle")) as {
      rows: { mutedAt: number | null; settledAt: number | null }[];
    };
    expect(rows[0]!.mutedAt).toBeNull();
    expect(rows[0]!.settledAt).toEqual(expect.any(Number));
  });
});

describe("push level around a mute", () => {
  it("hands back the saved push level on unmute", async () => {
    const server = startServer();
    await server.call("mute", {
      threadId: "thr_a",
      pushLevelBeforeMute: "input-only",
    });
    expect(await server.call("unmute", { threadId: "thr_a" })).toEqual({
      ok: true,
      pushLevelBeforeMute: "input-only",
    });
  });

  it("reports no saved level for a thread that was never muted", async () => {
    const server = startServer();
    expect(await server.call("unmute", { threadId: "thr_b" })).toEqual({
      ok: true,
      pushLevelBeforeMute: null,
    });
  });
});

describe("bulk actions and undo", () => {
  type Rows = {
    rows: {
      threadId: string;
      settledAt: number | null;
      snoozedUntil: number | null;
      mutedAt: number | null;
    }[];
  };

  it("settles many threads at once", async () => {
    const server = startServer();
    await server.call("settleMany", { threadIds: ["thr_a", "thr_b"] });
    const { rows } = (await server.call("listLifecycle")) as Rows;
    expect(rows.map((row) => row.threadId).sort()).toEqual(["thr_a", "thr_b"]);
    expect(rows.every((row) => row.settledAt !== null)).toBe(true);
  });

  it("snoozes many threads until one wake time", async () => {
    const server = startServer();
    await server.call("snoozeMany", {
      threadIds: ["thr_a", "thr_b"],
      snoozedUntil: 5_000,
    });
    const { rows } = (await server.call("listLifecycle")) as Rows;
    expect(rows.map((row) => row.snoozedUntil)).toEqual([5_000, 5_000]);
  });

  it("restores each thread's previous state on undo", async () => {
    const server = startServer();
    await server.call("settle", { threadId: "thr_old" });
    const before = ((await server.call("listLifecycle")) as Rows).rows[0]!;
    await server.call("settleMany", { threadIds: ["thr_old", "thr_new"] });
    await server.call("restoreLifecycle", {
      entries: [
        {
          threadId: "thr_old",
          row: {
            settledAt: before.settledAt,
            snoozedUntil: null,
            snoozedAt: null,
            mutedAt: null,
          },
        },
        { threadId: "thr_new", row: null },
      ],
    });
    const { rows } = (await server.call("listLifecycle")) as Rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.settledAt).toBe(before.settledAt);
  });
});

describe("settle on read setting", () => {
  it("records when it was switched on and clears when off", async () => {
    const server = startServer();
    expect(await server.call("getSettings")).toMatchObject({
      settleOnReadSince: null,
    });
    const on = (await server.call("setSettleOnRead", { enabled: true })) as {
      settleOnReadSince: number;
    };
    expect(on.settleOnReadSince).toEqual(expect.any(Number));
    expect(server.published).toContain("settings");
    expect(await server.call("setSettleOnRead", { enabled: false })).toEqual({
      settleOnReadSince: null,
    });
  });

  it("keeps the original time when switched on twice", async () => {
    const server = startServer();
    const first = await server.call("setSettleOnRead", { enabled: true });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await server.call("setSettleOnRead", { enabled: true })).toEqual(
      first,
    );
  });
});

describe("auto-archive settled threads", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const quiet = (overrides: Partial<FakeThread> = {}): FakeThread => ({
    archivedAt: null,
    pinnedAt: null,
    latestAttentionAt: 0,
    status: "idle",
    queuedMessageCount: 0,
    ...overrides,
  });

  async function settledDaysAgo(
    server: ReturnType<typeof startServer>,
    entries: Record<string, number>,
  ) {
    await server.call("restoreLifecycle", {
      entries: Object.entries(entries).map(([threadId, days]) => ({
        threadId,
        row: {
          settledAt: Date.now() - days * DAY,
          snoozedUntil: null,
          snoozedAt: null,
          mutedAt: null,
        },
      })),
    });
  }

  it("is set to Never by default and archives nothing", async () => {
    const server = startServer({ thr_old: quiet() });
    expect(await server.call("getSettings")).toMatchObject({
      autoArchiveSettledDays: null,
    });
    await settledDaysAgo(server, { thr_old: 400 });
    await server.runSchedule("auto-archive-settled");
    expect(server.archivedCalls).toEqual([]);
  });

  it("archives a thread settled longer than the chosen days", async () => {
    const server = startServer({ thr_old: quiet(), thr_new: quiet() });
    await server.call("setAutoArchiveSettledDays", { days: 7 });
    await settledDaysAgo(server, { thr_old: 8, thr_new: 3 });
    await server.runSchedule("auto-archive-settled");
    expect(server.archivedCalls).toEqual(["thr_old"]);
    const { rows } = (await server.call("listLifecycle")) as {
      rows: { threadId: string }[];
    };
    expect(rows.map((row) => row.threadId)).toEqual(["thr_new"]);
  });

  it("skips threads that are pinned, running, or have news since settling", async () => {
    const server = startServer({
      thr_pinned: quiet({ pinnedAt: 1 }),
      thr_running: quiet({ status: "active" }),
      thr_news: quiet({ latestAttentionAt: Date.now() }),
      thr_queued: quiet({ queuedMessageCount: 1 }),
    });
    await server.call("setAutoArchiveSettledDays", { days: 1 });
    await settledDaysAgo(server, {
      thr_pinned: 5,
      thr_running: 5,
      thr_news: 5,
      thr_queued: 5,
    });
    await server.runSchedule("auto-archive-settled");
    expect(server.archivedCalls).toEqual([]);
  });
});
