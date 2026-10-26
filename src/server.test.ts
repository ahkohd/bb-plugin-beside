import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import plugin from "./server";

type Handler = (input: unknown) => Promise<unknown>;

function startServer() {
  const db = new DatabaseSync(":memory:");
  const handlers = new Map<string, Handler>();
  const eventHandlers = new Map<string, (payload: unknown) => void>();
  const published: string[] = [];
  const bb = {
    storage: {
      database: () => db,
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
