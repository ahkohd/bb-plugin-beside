import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import plugin, { bbSidebarRpcContract } from "./server";

type Handler = (input: unknown) => Promise<unknown>;

interface FakeThread {
  archivedAt: number | null;
  pinnedAt: number | null;
  parentThreadId: string | null;
  hasPendingInteraction: boolean;
  latestAttentionAt: number;
  status: string;
  runtime: { displayStatus: string };
  queuedWork: string;
  activity: {
    activeBackgroundAgentCount: number;
    activeBackgroundCommandCount: number;
    activeWorkflowCount: number;
    activePlanModeCount: number;
    activeGoalCount: number;
  };
}

function startServer(
  threads: Record<string, FakeThread> = {},
  settings: Record<string, string> = {},
) {
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
        list: async ({
          limit = 500,
          offset = 0,
        }: {
          limit?: number;
          offset?: number;
        }) =>
          Object.entries(threads)
            .filter(([, thread]) => thread.archivedAt === null)
            .map(([id, thread]) => ({ id, ...thread }))
            .slice(offset, offset + limit),
        archive: async ({ threadId }: { threadId: string }) => {
          const cascade = [threadId];
          for (const id of cascade) {
            for (const [childId, child] of Object.entries(threads)) {
              if (child.parentThreadId === id) cascade.push(childId);
            }
          }
          for (const id of cascade) {
            archivedCalls.push(id);
            threads[id]!.archivedAt = Date.now();
          }
          return { ok: true, archivedThreadIds: cascade };
        },
      },
    },
    settings: {
      define: () => ({
        get: async () => ({ ...settings }),
        onChange: () => undefined,
      }),
    },
    events: {
      on: (event: string, fn: (payload: unknown) => void) =>
        eventHandlers.set(event, fn),
    },
  } as unknown as BbPluginApi;
  plugin(bb);
  return {
    call: (method: string, input: unknown = {}) => {
      const contract = (
        bbSidebarRpcContract as unknown as Record<
          string,
          { input: { parse(value: unknown): unknown } }
        >
      )[method]!;
      return handlers.get(method)!(contract.input.parse(input));
    },
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
    parentThreadId: null,
    hasPendingInteraction: false,
    latestAttentionAt: 0,
    status: "idle",
    runtime: { displayStatus: "idle" },
    queuedWork: "none",
    activity: {
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activeWorkflowCount: 0,
      activePlanModeCount: 0,
      activeGoalCount: 0,
    },
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
      thr_queued: quiet({ queuedWork: "waiting" }),
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

describe("moving state between installs", () => {
  it("exports everything and imports it into a fresh store", async () => {
    const source = startServer();
    await source.call("mute", {
      threadId: "thr_muted",
      pushLevelBeforeMute: "input-only",
    });
    await source.call("settle", { threadId: "thr_done" });
    await source.call("replaceLayoutSet", {
      set: "collapsedShelves",
      items: ["settled"],
    });
    await source.call("setAutoArchiveSettledDays", { days: 7 });
    const exported = await source.call("exportState");

    const target = startServer();
    await target.call("importState", exported);
    expect(await target.call("exportState")).toEqual(exported);
    expect(await target.call("unmute", { threadId: "thr_muted" })).toEqual({
      ok: true,
      pushLevelBeforeMute: "input-only",
    });
  });
});

describe("auto-archive and child threads", () => {
  const quiet = (overrides: Partial<FakeThread> = {}): FakeThread => ({
    archivedAt: null,
    pinnedAt: null,
    parentThreadId: null,
    hasPendingInteraction: false,
    latestAttentionAt: 0,
    status: "idle",
    runtime: { displayStatus: "idle" },
    queuedWork: "none",
    activity: {
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activeWorkflowCount: 0,
      activePlanModeCount: 0,
      activeGoalCount: 0,
    },
    ...overrides,
  });
  const settledLongAgo = (threadIds: string[]) => ({
    entries: threadIds.map((threadId) => ({
      threadId,
      row: {
        settledAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
        snoozedUntil: null,
        snoozedAt: null,
        mutedAt: null,
      },
    })),
  });

  it("leaves a parent whose child is working or asking", async () => {
    const server = startServer({
      thr_parent: quiet(),
      thr_child: quiet({
        parentThreadId: "thr_parent",
        hasPendingInteraction: true,
      }),
    });
    await server.call("setAutoArchiveSettledDays", { days: 1 });
    await server.call("restoreLifecycle", settledLongAgo(["thr_parent"]));
    await server.runSchedule("auto-archive-settled");
    expect(server.archivedCalls).toEqual([]);
  });

  it("skips a settled child whose parent is still visible", async () => {
    const server = startServer({
      thr_parent: quiet(),
      thr_child: quiet({ parentThreadId: "thr_parent" }),
    });
    await server.call("setAutoArchiveSettledDays", { days: 1 });
    await server.call("restoreLifecycle", settledLongAgo(["thr_child"]));
    await server.runSchedule("auto-archive-settled");
    expect(server.archivedCalls).toEqual([]);
  });

  it("archives a quiet parent with its children and forgets them all", async () => {
    const server = startServer({
      thr_parent: quiet(),
      thr_child: quiet({ parentThreadId: "thr_parent" }),
    });
    await server.call("setAutoArchiveSettledDays", { days: 1 });
    await server.call(
      "restoreLifecycle",
      settledLongAgo(["thr_parent", "thr_child"]),
    );
    await server.runSchedule("auto-archive-settled");
    expect(server.archivedCalls).toEqual(["thr_parent", "thr_child"]);
    expect(await server.call("listLifecycle")).toEqual({ rows: [] });
  });
});

describe("archive cleanup", () => {
  it("forgets a thread's state and opened-parent entry when it is archived", async () => {
    const server = startServer();
    await server.call("settle", { threadId: "thr_a" });
    await server.call("replaceLayoutSet", {
      set: "expandedParents",
      items: ["thr_a", "thr_b"],
    });
    server.emit("thread.archived", { thread: { id: "thr_a" } });
    expect(await server.call("listLifecycle")).toEqual({ rows: [] });
    expect(await server.call("getLayout")).toMatchObject({
      expandedParents: ["thr_b"],
    });
  });
});

describe("muting twice", () => {
  it("keeps the push level saved by the first mute", async () => {
    const server = startServer();
    await server.call("mute", {
      threadId: "thr_a",
      pushLevelBeforeMute: "input-only",
    });
    await server.call("mute", {
      threadId: "thr_a",
      pushLevelBeforeMute: "muted",
    });
    expect(await server.call("unmute", { threadId: "thr_a" })).toEqual({
      ok: true,
      pushLevelBeforeMute: "input-only",
    });
  });
});

describe("layout size", () => {
  it("keeps the newest opened parents instead of resetting past the cap", async () => {
    const server = startServer();
    const items = Array.from({ length: 5000 }, (_, index) => `thr_${index}`);
    await server.call("replaceLayoutSet", { set: "expandedParents", items });
    await server.call("setLayoutMember", {
      set: "expandedParents",
      item: "thr_new",
      member: true,
    });
    const { expandedParents } = (await server.call("getLayout")) as {
      expandedParents: string[];
    };
    expect(expandedParents).toHaveLength(5000);
    expect(expandedParents.at(-1)).toBe("thr_new");
    expect(expandedParents[0]).toBe("thr_1");
  });
});

describe("decision mode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const answers = (overrides: Record<string, string> = {}) => ({
    asks_user: { choice: overrides.asks_user ?? "report", confidence: 0.95 },
    next_actor: { choice: overrides.next_actor ?? "nobody", confidence: 0.9 },
    worth_now: { choice: overrides.worth_now ?? "fyi", confidence: 0.85 },
  });

  const stubModel = (body: unknown, status = 200) => {
    const request = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify(body), { status }),
    );
    vi.stubGlobal("fetch", request);
    return request;
  };

  const settledThread = async (
    settings: Record<string, string>,
  ): Promise<ReturnType<typeof startServer>> => {
    const { decisionEndpoint, decisionModel, decisionApiKey } = settings;
    const server = startServer(
      {},
      decisionApiKey === undefined ? {} : { decisionApiKey },
    );
    if (decisionEndpoint !== undefined) {
      await server.call("setDecisionConfig", {
        provider: "custom",
        endpoint: decisionEndpoint,
        model: decisionModel ?? "",
      });
    }
    await server.call("settle", { threadId: "t1" });
    return server;
  };

  const rowFor = async (server: ReturnType<typeof startServer>) => {
    const { rows } = (await server.call("listLifecycle")) as {
      rows: { threadId: string; quietThrough?: number | null; judgedThrough?: number | null }[];
    };
    return rows.find((row) => row.threadId === "t1");
  };

  const finishTurn = async (
    server: ReturnType<typeof startServer>,
    attentionAt: number,
    text: string | null = "All tests pass.",
  ) => {
    server.emit("thread.idle", {
      thread: {
        id: "t1",
        title: "Fix",
        titleFallback: null,
        latestAttentionAt: attentionAt,
      },
      lastAssistantText: text,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
  };

  it("does nothing without an endpoint", async () => {
    const request = stubModel({ answers: answers() });
    const server = await settledThread({});
    await finishTurn(server, Date.now() + 1000);
    expect(request).not.toHaveBeenCalled();
    expect((await rowFor(server))?.judgedThrough ?? null).toBeNull();
  });

  it("keeps quiet news parked and sends no key when none is set", async () => {
    const request = stubModel({ model: "d1-3B", answers: answers() });
    const server = await settledThread({
      decisionEndpoint: "http://model.test/v1/systemone",
      decisionModel: "d1-3B",
    });
    const attentionAt = Date.now() + 1000;
    await finishTurn(server, attentionAt);
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe("http://model.test/v1/systemone");
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "d1-3B",
      state: { thread_title: "Fix", final_assistant_message: "All tests pass." },
    });
    expect(await rowFor(server)).toMatchObject({
      quietThrough: attentionAt,
      judgedThrough: attentionAt,
    });
  });

  it("sends the key as a bearer token", async () => {
    const request = stubModel({ answers: answers() });
    const server = await settledThread({
      decisionEndpoint: "http://model.test/v1/systemone",
      decisionApiKey: "secret-key",
    });
    await finishTurn(server, Date.now() + 1000);
    const init = request.mock.calls[0]![1];
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer secret-key",
    );
  });

  it("brings back news that asks for the user", async () => {
    stubModel({ answers: answers({ asks_user: "request", next_actor: "user" }) });
    const server = await settledThread({
      decisionEndpoint: "http://model.test/v1/systemone",
    });
    const attentionAt = Date.now() + 1000;
    await finishTurn(server, attentionAt);
    expect(await rowFor(server)).toMatchObject({
      quietThrough: null,
      judgedThrough: attentionAt,
    });
    const status = (await server.call("getDecisionStatus")) as {
      recent: { quiet: boolean; reason: string }[];
    };
    expect(status.recent[0]).toMatchObject({
      title: "Fix",
      quiet: false,
      reason: "asks you",
      answers: { asks_user: { choice: "request" } },
    });
  });

  it("fails open when the model is unreachable", async () => {
    stubModel({ error: "down" }, 503);
    const server = await settledThread({
      decisionEndpoint: "http://model.test/v1/systemone",
    });
    const attentionAt = Date.now() + 1000;
    await finishTurn(server, attentionAt);
    expect(await rowFor(server)).toMatchObject({
      quietThrough: null,
      judgedThrough: attentionAt,
    });
    const status = (await server.call("getDecisionStatus")) as {
      lastError: string | null;
    };
    expect(status.lastError).toContain("503");
  });

  it("ignores turns that finished before the thread was parked", async () => {
    const request = stubModel({ answers: answers() });
    const server = await settledThread({
      decisionEndpoint: "http://model.test/v1/systemone",
    });
    await finishTurn(server, Date.now() - 60_000);
    expect(request).not.toHaveBeenCalled();
  });

  it("clears verdicts when the thread is parked again", async () => {
    stubModel({ answers: answers() });
    const server = await settledThread({
      decisionEndpoint: "http://model.test/v1/systemone",
    });
    await finishTurn(server, Date.now() + 1000);
    await server.call("settle", { threadId: "t1" });
    expect(await rowFor(server)).toMatchObject({
      quietThrough: null,
      judgedThrough: null,
    });
  });
});

describe("decision model setup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is off until a model is chosen", async () => {
    const server = startServer();
    expect(await server.call("getDecisionConfig")).toMatchObject({
      provider: "off",
      endpoint: "",
      keySet: false,
    });
  });

  it("builds the d1 endpoint from a server address and sends no key", async () => {
    const request = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(
          JSON.stringify({
            model: "d1-3B",
            answers: {
              asks_user: { choice: "report", confidence: 0.9 },
              next_actor: { choice: "nobody", confidence: 0.9 },
              worth_now: { choice: "fyi", confidence: 0.9 },
            },
          }),
        ),
    );
    vi.stubGlobal("fetch", request);
    const server = startServer({}, { decisionApiKey: "typesafe-key" });
    expect(
      await server.call("setDecisionConfig", {
        provider: "d1",
        address: "behemoth:30001",
      }),
    ).toMatchObject({
      provider: "d1",
      endpoint: "http://behemoth:30001/v1/systemone",
      model: "d1-3B",
    });
    expect(await server.call("checkDecisionConnection")).toMatchObject({
      ok: true,
      model: "d1-3B",
    });
    const init = request.mock.calls[0]![1];
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
  });

  it("uses TypeSafe's endpoint for Jev and asks for a key first", async () => {
    const server = startServer();
    expect(
      await server.call("setDecisionConfig", { provider: "jev" }),
    ).toMatchObject({
      endpoint: "https://api.typesafe.ai/v1/systemone",
      model: "jev-latest",
    });
    expect(await server.call("checkDecisionConnection")).toMatchObject({
      ok: false,
      error: "Add your TypeSafe API key first",
    });
  });

  it("rejects a custom endpoint that is not a URL", async () => {
    const server = startServer();
    await expect(
      server.call("setDecisionConfig", { provider: "custom", endpoint: "nope" }),
    ).rejects.toThrow("full endpoint URL");
  });

  it("keeps limits per model and resets them to the defaults", async () => {
    const server = startServer();
    const limits = { request: 0.3, user: 0.6, agent: 0.6, review: 0.9 };
    const saved = (await server.call("setDecisionLimits", {
      provider: "jev",
      limits,
    })) as { limits: Record<string, unknown> };
    expect(saved.limits.jev).toEqual(limits);
    expect(saved.limits.d1).toEqual({
      request: 0.2,
      user: 0.5,
      agent: 0.5,
      review: 0.5,
    });
    const reset = (await server.call("setDecisionLimits", {
      provider: "jev",
      limits: null,
    })) as { limits: Record<string, unknown> };
    expect(reset.limits.jev).toEqual({
      request: 0.2,
      user: 0.5,
      agent: 0.5,
      review: 0.85,
    });
  });
});
