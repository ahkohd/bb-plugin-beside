// bb-sidebar backend — the settled / snoozed store.
//
// This state lives in the plugin's own SQLite database, never on bb's thread.
// Putting it on the thread would mean a schema change, a wire change, and a
// HOST_DAEMON_PROTOCOL_VERSION bump for something only this sidebar
// understands. Here, uninstalling the plugin removes its state with it.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  SETTINGS_CHANNEL,
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
  `CREATE TABLE IF NOT EXISTS settings (
     key    TEXT PRIMARY KEY,
     value  TEXT NOT NULL
   )`,
];

export const AUTO_ARCHIVE_DAY_OPTIONS = [1, 3, 7, 14, 30] as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const IDLE_STATUSES: ReadonlySet<string> = new Set(["idle", "error"]);
const autoArchiveDaysSchema = z
  .number()
  .int()
  .refine((days) =>
    (AUTO_ARCHIVE_DAY_OPTIONS as readonly number[]).includes(days),
  )
  .nullable();

const threadIdsSchema = z.array(z.string().trim().min(1)).min(1).max(1000);

const lifecycleRowSchema = z.object({
  settledAt: z.number().nullable(),
  snoozedUntil: z.number().nullable(),
  snoozedAt: z.number().nullable(),
  mutedAt: z.number().nullable(),
});

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
  settleMany: {
    input: z.object({ threadIds: threadIdsSchema }),
    output: z.object({ ok: z.boolean() }),
  },
  snoozeMany: {
    input: z.object({
      threadIds: threadIdsSchema,
      snoozedUntil: z.number().int().positive(),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  restoreLifecycle: {
    input: z.object({
      entries: z
        .array(
          z.object({
            threadId: z.string().trim().min(1),
            row: lifecycleRowSchema.nullable(),
          }),
        )
        .min(1)
        .max(1000),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  exportState: {
    input: z.object({}),
    output: z.object({
      lifecycle: z.array(
        lifecycleRowSchema.extend({
          threadId: z.string(),
          pushLevelBeforeMute: z.string().nullable(),
        }),
      ),
      layout: z.record(z.string(), z.array(z.string())),
      settings: z.record(z.string(), z.string()),
    }),
  },
  importState: {
    input: z.object({
      lifecycle: z
        .array(
          lifecycleRowSchema.extend({
            threadId: z.string().trim().min(1),
            pushLevelBeforeMute: pushLevelSchema.nullable(),
          }),
        )
        .max(10000),
      layout: z.record(layoutSetNameSchema, layoutItemsSchema),
      settings: z.record(
        z.enum(["settleOnReadSince", "autoArchiveSettledDays"]),
        z.string(),
      ),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  getSettings: {
    input: z.object({}),
    output: z.object({
      settleOnReadSince: z.number().nullable(),
      autoArchiveSettledDays: z.number().nullable(),
    }),
  },
  setAutoArchiveSettledDays: {
    input: z.object({ days: autoArchiveDaysSchema }),
    output: z.object({ autoArchiveSettledDays: z.number().nullable() }),
  },
  setSettleOnRead: {
    input: z.object({ enabled: z.boolean() }),
    output: z.object({ settleOnReadSince: z.number().nullable() }),
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

  const readSettleOnReadSince = (): number | null => {
    const row = db
      .prepare(`SELECT value FROM settings WHERE key = 'settleOnReadSince'`)
      .get() as { value: string } | undefined;
    const since = row === undefined ? NaN : Number(row.value);
    return Number.isFinite(since) ? since : null;
  };

  const readAutoArchiveDays = (): number | null => {
    const row = db
      .prepare(
        `SELECT value FROM settings WHERE key = 'autoArchiveSettledDays'`,
      )
      .get() as { value: string } | undefined;
    const parsed = autoArchiveDaysSchema.safeParse(
      row === undefined ? null : Number(row.value),
    );
    return parsed.success ? parsed.data : null;
  };

  const archiveLongSettledThreads = async (now = Date.now()) => {
    const days = readAutoArchiveDays();
    if (days === null) return [];
    const cutoff = now - days * DAY_MS;
    const archived: string[] = [];
    for (const row of readAll()) {
      if (row.settledAt === null || row.settledAt > cutoff) continue;
      const thread = await bb.sdk.threads
        .get({ threadId: row.threadId })
        .catch(() => null);
      if (
        thread === null ||
        thread.archivedAt !== null ||
        thread.pinnedAt !== null ||
        thread.latestAttentionAt > row.settledAt ||
        !IDLE_STATUSES.has(thread.status) ||
        thread.queuedMessageCount > 0
      ) {
        continue;
      }
      const result = await bb.sdk.threads
        .archive({ threadId: row.threadId })
        .catch(() => null);
      if (result === null) continue;
      clear(row.threadId);
      archived.push(...result.archivedThreadIds);
    }
    return archived;
  };

  bb.background.schedule("auto-archive-settled", "17 * * * *", async () => {
    await archiveLongSettledThreads();
  });

  const writeMany = (rows: StoredLifecycleRow[]) => {
    const insert = db.transaction((all: StoredLifecycleRow[]) => {
      for (const row of all) {
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
      }
    });
    insert(rows);
    bb.realtime.publish(LIFECYCLE_CHANNEL, { threadIds: rows.length });
  };

  bb.rpc.register(bbSidebarRpcContract, {
    async settleMany({ threadIds }) {
      const now = Date.now();
      writeMany(
        threadIds.map((threadId) => ({
          threadId,
          settledAt: now,
          snoozedUntil: null,
          snoozedAt: null,
          mutedAt: null,
        })),
      );
      return { ok: true };
    },
    async snoozeMany({ threadIds, snoozedUntil }) {
      const now = Date.now();
      writeMany(
        threadIds.map((threadId) => ({
          threadId,
          settledAt: null,
          snoozedUntil,
          snoozedAt: now,
          mutedAt: null,
        })),
      );
      return { ok: true };
    },
    async restoreLifecycle({ entries }) {
      const restore = db.transaction(() => {
        for (const { threadId, row } of entries) {
          if (row === null) {
            db.prepare(`DELETE FROM thread_lifecycle WHERE thread_id = ?`).run(
              threadId,
            );
          } else {
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
              threadId,
              row.settledAt,
              row.snoozedUntil,
              row.snoozedAt,
              row.mutedAt,
            );
          }
        }
      });
      restore();
      bb.realtime.publish(LIFECYCLE_CHANNEL, { threadIds: entries.length });
      return { ok: true };
    },
    async exportState() {
      const lifecycle = (
        db
          .prepare(
            `SELECT thread_id, settled_at, snoozed_until, snoozed_at, muted_at,
                    push_level_before_mute
               FROM thread_lifecycle`,
          )
          .all() as (LifecycleDbRow & {
          push_level_before_mute: string | null;
        })[]
      ).map((row) => ({
        threadId: row.thread_id,
        settledAt: row.settled_at,
        snoozedUntil: row.snoozed_until,
        snoozedAt: row.snoozed_at,
        mutedAt: row.muted_at,
        pushLevelBeforeMute: row.push_level_before_mute,
      }));
      const layout = Object.fromEntries(
        (
          db.prepare(`SELECT set_name, items FROM layout_sets`).all() as {
            set_name: string;
            items: string;
          }[]
        ).map((row) => [row.set_name, JSON.parse(row.items) as string[]]),
      );
      const settings = Object.fromEntries(
        (
          db.prepare(`SELECT key, value FROM settings`).all() as {
            key: string;
            value: string;
          }[]
        ).map((row) => [row.key, row.value]),
      );
      return { lifecycle, layout, settings };
    },
    async importState({ lifecycle, layout, settings }) {
      const load = db.transaction(() => {
        for (const row of lifecycle) {
          db.prepare(
            `INSERT INTO thread_lifecycle
               (thread_id, settled_at, snoozed_until, snoozed_at, muted_at,
                push_level_before_mute)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(thread_id) DO UPDATE SET
               settled_at = excluded.settled_at,
               snoozed_until = excluded.snoozed_until,
               snoozed_at = excluded.snoozed_at,
               muted_at = excluded.muted_at,
               push_level_before_mute = excluded.push_level_before_mute`,
          ).run(
            row.threadId,
            row.settledAt,
            row.snoozedUntil,
            row.snoozedAt,
            row.mutedAt,
            row.pushLevelBeforeMute,
          );
        }
        for (const [set, items] of Object.entries(layout)) {
          db.prepare(
            `INSERT INTO layout_sets (set_name, items) VALUES (?, ?)
             ON CONFLICT(set_name) DO UPDATE SET items = excluded.items`,
          ).run(set, JSON.stringify(items));
        }
        for (const [key, value] of Object.entries(settings)) {
          db.prepare(
            `INSERT INTO settings (key, value) VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          ).run(key, value);
        }
      });
      load();
      bb.realtime.publish(LIFECYCLE_CHANNEL, {});
      bb.realtime.publish(LAYOUT_CHANNEL, {});
      bb.realtime.publish(SETTINGS_CHANNEL, {});
      return { ok: true };
    },
    async getSettings() {
      return {
        settleOnReadSince: readSettleOnReadSince(),
        autoArchiveSettledDays: readAutoArchiveDays(),
      };
    },
    async setAutoArchiveSettledDays({ days }) {
      if (days === null) {
        db.prepare(
          `DELETE FROM settings WHERE key = 'autoArchiveSettledDays'`,
        ).run();
      } else {
        db.prepare(
          `INSERT INTO settings (key, value) VALUES ('autoArchiveSettledDays', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        ).run(String(days));
      }
      bb.realtime.publish(SETTINGS_CHANNEL, {});
      return { autoArchiveSettledDays: readAutoArchiveDays() };
    },
    async setSettleOnRead({ enabled }) {
      if (enabled) {
        if (readSettleOnReadSince() === null) {
          db.prepare(
            `INSERT INTO settings (key, value) VALUES ('settleOnReadSince', ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          ).run(String(Date.now()));
        }
      } else {
        db.prepare(
          `DELETE FROM settings WHERE key = 'settleOnReadSince'`,
        ).run();
      }
      bb.realtime.publish(SETTINGS_CHANNEL, {});
      return { settleOnReadSince: readSettleOnReadSince() };
    },
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
