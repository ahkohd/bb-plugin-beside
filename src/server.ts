// bb-sidebar backend — the settled / snoozed store.
//
// This state lives in the plugin's own SQLite database, never on bb's thread.
// Putting it on the thread would mean a schema change, a wire change, and a
// HOST_DAEMON_PROTOCOL_VERSION bump for something only this sidebar
// understands. Here, uninstalling the plugin removes its state with it.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  LAYOUT_CHANNEL,
  LAYOUT_SET_NAMES,
  type LayoutSetName,
} from "./layoutSets";

const migrations = [
  `CREATE TABLE IF NOT EXISTS thread_lifecycle (
     thread_id      TEXT PRIMARY KEY,
     settled_at     INTEGER,
     snoozed_until  INTEGER,
     snoozed_at     INTEGER
   )`,
  `CREATE TABLE IF NOT EXISTS layout_sets (
     set_name  TEXT PRIMARY KEY,
     items     TEXT NOT NULL
   )`,
  `ALTER TABLE thread_lifecycle ADD COLUMN muted_at INTEGER`,
  `ALTER TABLE thread_lifecycle ADD COLUMN push_level_before_mute TEXT`,
];

export const PUSH_LEVELS = ["inherit", "all", "input-only", "muted"] as const;
const pushLevelSchema = z.enum(PUSH_LEVELS);

const layoutSetNameSchema = z.enum(LAYOUT_SET_NAMES);
const layoutItemsSchema = z.array(z.string().trim().min(1)).max(5000);

export interface StoredLifecycleRow {
  threadId: string;
  settledAt: number | null;
  snoozedUntil: number | null;
  snoozedAt: number | null;
  mutedAt: number | null;
}

interface LifecycleDbRow {
  thread_id: string;
  settled_at: number | null;
  snoozed_until: number | null;
  snoozed_at: number | null;
  muted_at: number | null;
}

const threadIdSchema = z.object({ threadId: z.string().trim().min(1) });

export const bbSidebarRpcContract = defineRpcContract({
  listLifecycle: {
    input: z.object({}),
    output: z.object({
      rows: z.array(
        z.object({
          threadId: z.string(),
          settledAt: z.number().nullable(),
          snoozedUntil: z.number().nullable(),
          snoozedAt: z.number().nullable(),
          mutedAt: z.number().nullable(),
        }),
      ),
    }),
  },
  settle: { input: threadIdSchema, output: z.object({ ok: z.boolean() }) },
  unsettle: { input: threadIdSchema, output: z.object({ ok: z.boolean() }) },
  snooze: {
    input: z.object({
      threadId: z.string().trim().min(1),
      // Absolute wake time, so a snooze means the same thing on every device.
      snoozedUntil: z.number().int().positive(),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  unsnooze: { input: threadIdSchema, output: z.object({ ok: z.boolean() }) },
  mute: {
    input: z.object({
      threadId: z.string().trim().min(1),
      pushLevelBeforeMute: pushLevelSchema.nullable().optional(),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  unmute: {
    input: threadIdSchema,
    output: z.object({
      ok: z.boolean(),
      pushLevelBeforeMute: pushLevelSchema.nullable(),
    }),
  },
  getLayout: {
    input: z.object({}),
    output: z.object({
      collapsedShelves: z.array(z.string()).nullable(),
      expandedParents: z.array(z.string()).nullable(),
    }),
  },
  setLayoutMember: {
    input: z.object({
      set: layoutSetNameSchema,
      item: z.string().trim().min(1),
      member: z.boolean(),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  replaceLayoutSet: {
    input: z.object({ set: layoutSetNameSchema, items: layoutItemsSchema }),
    output: z.object({ ok: z.boolean() }),
  },
});

/** Channel the frontend re-reads on. */
export const LIFECYCLE_CHANNEL = "lifecycle";

export default function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, migrations);

  const readAll = (): StoredLifecycleRow[] =>
    (
      db
        .prepare(
          `SELECT thread_id, settled_at, snoozed_until, snoozed_at, muted_at
             FROM thread_lifecycle`,
        )
        .all() as LifecycleDbRow[]
    ).map((row) => ({
      threadId: row.thread_id,
      settledAt: row.settled_at,
      snoozedUntil: row.snoozed_until,
      snoozedAt: row.snoozed_at,
      mutedAt: row.muted_at,
    }));

  const write = (row: StoredLifecycleRow): void => {
    db.prepare(
      `INSERT INTO thread_lifecycle
         (thread_id, settled_at, snoozed_until, snoozed_at, muted_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(thread_id) DO UPDATE SET
         settled_at = excluded.settled_at,
         snoozed_until = excluded.snoozed_until,
         snoozed_at = excluded.snoozed_at,
         muted_at = excluded.muted_at`,
    ).run(
      row.threadId,
      row.settledAt,
      row.snoozedUntil,
      row.snoozedAt,
      row.mutedAt,
    );
    bb.realtime.publish(LIFECYCLE_CHANNEL, { threadId: row.threadId });
  };

  const clear = (threadId: string): void => {
    db.prepare(`DELETE FROM thread_lifecycle WHERE thread_id = ?`).run(
      threadId,
    );
    bb.realtime.publish(LIFECYCLE_CHANNEL, { threadId });
  };

  const readLayoutSet = (set: LayoutSetName): string[] | null => {
    const row = db
      .prepare(`SELECT items FROM layout_sets WHERE set_name = ?`)
      .get(set) as { items: string } | undefined;
    if (row === undefined) return null;
    const parsed = layoutItemsSchema.safeParse(JSON.parse(row.items));
    return parsed.success ? parsed.data : [];
  };

  const writeLayoutSet = (set: LayoutSetName, items: readonly string[]) => {
    db.prepare(
      `INSERT INTO layout_sets (set_name, items) VALUES (?, ?)
       ON CONFLICT(set_name) DO UPDATE SET items = excluded.items`,
    ).run(set, JSON.stringify([...new Set(items)]));
    bb.realtime.publish(LAYOUT_CHANNEL, { set });
  };

  bb.rpc.register(bbSidebarRpcContract, {
    async getLayout() {
      return {
        collapsedShelves: readLayoutSet("collapsedShelves"),
        expandedParents: readLayoutSet("expandedParents"),
      };
    },
    async setLayoutMember({ set, item, member }) {
      const current = readLayoutSet(set) ?? [];
      const without = current.filter((existing) => existing !== item);
      writeLayoutSet(set, member ? [...without, item] : without);
      return { ok: true };
    },
    async replaceLayoutSet({ set, items }) {
      writeLayoutSet(set, items);
      return { ok: true };
    },
    async listLifecycle() {
      return { rows: readAll() };
    },
    async settle({ threadId }) {
      // Settling clears any snooze: they are two answers to the same
      // question, and holding both would make the shelf order ambiguous.
      write({
        threadId,
        settledAt: Date.now(),
        snoozedUntil: null,
        snoozedAt: null,
        mutedAt: null,
      });
      return { ok: true };
    },
    async unsettle({ threadId }) {
      clear(threadId);
      return { ok: true };
    },
    async snooze({ threadId, snoozedUntil }) {
      const now = Date.now();
      write({
        threadId,
        settledAt: null,
        snoozedUntil,
        snoozedAt: now,
        mutedAt: null,
      });
      return { ok: true };
    },
    async unsnooze({ threadId }) {
      clear(threadId);
      return { ok: true };
    },
    async mute({ threadId, pushLevelBeforeMute }) {
      write({
        threadId,
        settledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        mutedAt: Date.now(),
      });
      db.prepare(
        `UPDATE thread_lifecycle SET push_level_before_mute = ? WHERE thread_id = ?`,
      ).run(pushLevelBeforeMute ?? null, threadId);
      return { ok: true };
    },
    async unmute({ threadId }) {
      const stored = db
        .prepare(
          `SELECT push_level_before_mute FROM thread_lifecycle WHERE thread_id = ?`,
        )
        .get(threadId) as { push_level_before_mute: string | null } | undefined;
      const parsed = pushLevelSchema.safeParse(stored?.push_level_before_mute);
      clear(threadId);
      return {
        ok: true,
        pushLevelBeforeMute: parsed.success ? parsed.data : null,
      };
    },
  });

  // A deleted thread must not leave a row behind that would park a future
  // thread reusing the id, and stale rows accumulate otherwise.
  bb.events.on("thread.deleted", ({ thread }) => {
    clear(thread.id);
    const expanded = readLayoutSet("expandedParents");
    if (expanded?.includes(thread.id)) {
      writeLayoutSet(
        "expandedParents",
        expanded.filter((id) => id !== thread.id),
      );
    }
  });
}
