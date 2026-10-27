// Beside backend — the settled / snoozed store.
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
import {
  askDecisionModel,
  DEFAULT_DECISION_MODEL,
  judgeAnswers,
  type Verdict,
} from "./decisionModel";

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
  `ALTER TABLE thread_lifecycle ADD COLUMN quiet_through INTEGER`,
  `CREATE TABLE IF NOT EXISTS decisions (
     thread_id     TEXT NOT NULL,
     attention_at  INTEGER NOT NULL,
     quiet         INTEGER NOT NULL,
     reason        TEXT NOT NULL,
     answers       TEXT,
     model         TEXT,
     decided_at    INTEGER NOT NULL,
     PRIMARY KEY (thread_id, attention_at)
   )`,
  `ALTER TABLE thread_lifecycle ADD COLUMN judged_through INTEGER`,
];

export const AUTO_ARCHIVE_DAY_OPTIONS = [1, 3, 7, 14, 30] as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_JUDGED_MESSAGE_CHARS = 12_000;
const MAX_DECISION_LOG = 500;
const LIST_PAGE_SIZE = 500;
const MAX_LAYOUT_ITEMS = 5000;
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
  quietThrough?: number | null;
  judgedThrough?: number | null;
}

interface LifecycleDbRow {
  thread_id: string;
  settled_at: number | null;
  snoozed_until: number | null;
  snoozed_at: number | null;
  muted_at: number | null;
  quiet_through?: number | null;
  judged_through?: number | null;
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
          quietThrough: z.number().nullable().optional(),
          judgedThrough: z.number().nullable().optional(),
        }),
      ),
    }),
  },
  getDecisionStatus: {
    input: z.object({}),
    output: z.object({
      enabled: z.boolean(),
      lastError: z.string().nullable(),
      recent: z.array(
        z.object({
          threadId: z.string(),
          attentionAt: z.number(),
          quiet: z.boolean(),
          reason: z.string(),
          model: z.string().nullable(),
          decidedAt: z.number(),
        }),
      ),
    }),
  },
  testDecisionModel: {
    input: z.object({
      message: z.string().trim().min(1).max(20000),
      title: z.string().max(500).optional(),
    }),
    output: z.object({
      quiet: z.boolean(),
      reason: z.string(),
      model: z.string().nullable(),
      answers: z.record(z.string(), z.unknown()),
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
  getMuteState: {
    input: threadIdSchema,
    output: z.object({ pushLevelBeforeMute: pushLevelSchema.nullable() }),
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
      layout: z.partialRecord(layoutSetNameSchema, layoutItemsSchema),
      settings: z.partialRecord(
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
          `SELECT thread_id, settled_at, snoozed_until, snoozed_at, muted_at,
                  quiet_through, judged_through
             FROM thread_lifecycle`,
        )
        .all() as LifecycleDbRow[]
    ).map((row) => ({
      threadId: row.thread_id,
      settledAt: row.settled_at,
      snoozedUntil: row.snoozed_until,
      snoozedAt: row.snoozed_at,
      mutedAt: row.muted_at,
      quietThrough: row.quiet_through ?? null,
      judgedThrough: row.judged_through ?? null,
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
         muted_at = excluded.muted_at,
         quiet_through = NULL,
         judged_through = NULL`,
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
    const parsed = z.array(z.string()).safeParse(JSON.parse(row.items));
    return parsed.success ? parsed.data.slice(-MAX_LAYOUT_ITEMS) : [];
  };

  const writeLayoutSet = (set: LayoutSetName, items: readonly string[]) => {
    db.prepare(
      `INSERT INTO layout_sets (set_name, items) VALUES (?, ?)
       ON CONFLICT(set_name) DO UPDATE SET items = excluded.items`,
    ).run(set, JSON.stringify([...new Set(items)].slice(-MAX_LAYOUT_ITEMS)));
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

  const readRow = (threadId: string): StoredLifecycleRow | undefined => {
    const row = db
      .prepare(
        `SELECT thread_id, settled_at, snoozed_until, snoozed_at, muted_at
           FROM thread_lifecycle WHERE thread_id = ?`,
      )
      .get(threadId) as LifecycleDbRow | undefined;
    return row === undefined
      ? undefined
      : {
          threadId: row.thread_id,
          settledAt: row.settled_at,
          snoozedUntil: row.snoozed_until,
          snoozedAt: row.snoozed_at,
          mutedAt: row.muted_at,
        };
  };

  const forgetThread = (threadId: string): void => {
    clear(threadId);
    const expanded = readLayoutSet("expandedParents");
    if (expanded?.includes(threadId)) {
      writeLayoutSet(
        "expandedParents",
        expanded.filter((id) => id !== threadId),
      );
    }
  };

  type ListedThread = Awaited<ReturnType<typeof bb.sdk.threads.list>>[number];

  const listUnarchivedThreads = async (): Promise<ListedThread[]> => {
    const threads: ListedThread[] = [];
    for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
      const page = await bb.sdk.threads.list({
        archived: false,
        includeHidden: true,
        limit: LIST_PAGE_SIZE,
        offset,
      });
      threads.push(...page);
      if (page.length < LIST_PAGE_SIZE) return threads;
    }
  };

  const isBusyOrNeedsYou = (thread: ListedThread): boolean =>
    thread.pinnedAt !== null ||
    thread.hasPendingInteraction ||
    !IDLE_STATUSES.has(thread.status) ||
    !IDLE_STATUSES.has(thread.runtime.displayStatus) ||
    thread.queuedWork !== "none" ||
    thread.activity.activeBackgroundAgentCount > 0 ||
    thread.activity.activeBackgroundCommandCount > 0 ||
    thread.activity.activeWorkflowCount > 0 ||
    thread.activity.activePlanModeCount > 0 ||
    thread.activity.activeGoalCount > 0;

  const archiveLongSettledThreads = async (now = Date.now()) => {
    const days = readAutoArchiveDays();
    if (days === null) return [];
    const cutoff = now - days * DAY_MS;
    const due = readAll().filter(
      (row) => row.settledAt !== null && row.settledAt <= cutoff,
    );
    if (due.length === 0) return [];

    const threads = await listUnarchivedThreads();
    const byId = new Map(threads.map((thread) => [thread.id, thread]));
    const childrenById = new Map<string, ListedThread[]>();
    for (const thread of threads) {
      if (thread.parentThreadId === null) continue;
      const siblings = childrenById.get(thread.parentThreadId) ?? [];
      siblings.push(thread);
      childrenById.set(thread.parentThreadId, siblings);
    }
    const anyDescendantBusy = (threadId: string): boolean => {
      const pending = [...(childrenById.get(threadId) ?? [])];
      const seen = new Set<string>();
      while (pending.length > 0) {
        const next = pending.pop()!;
        if (seen.has(next.id)) continue;
        seen.add(next.id);
        if (isBusyOrNeedsYou(next)) return true;
        pending.push(...(childrenById.get(next.id) ?? []));
      }
      return false;
    };

    const archived: string[] = [];
    for (const row of due) {
      const thread = byId.get(row.threadId);
      if (
        thread === undefined ||
        row.settledAt === null ||
        thread.latestAttentionAt > row.settledAt ||
        (thread.parentThreadId !== null && byId.has(thread.parentThreadId)) ||
        isBusyOrNeedsYou(thread) ||
        anyDescendantBusy(thread.id)
      ) {
        continue;
      }
      const current = readRow(row.threadId);
      if (current?.settledAt !== row.settledAt) continue;
      const result = await bb.sdk.threads
        .archive({ threadId: row.threadId })
        .catch(() => null);
      if (result === null) continue;
      for (const archivedId of result.archivedThreadIds)
        forgetThread(archivedId);
      archived.push(...result.archivedThreadIds);
    }
    return archived;
  };

  bb.background.schedule("auto-archive-settled", "17 * * * *", async () => {
    await archiveLongSettledThreads();
  });

  const deleteLifecycle = db.prepare(
    `DELETE FROM thread_lifecycle WHERE thread_id = ?`,
  );
  const upsertLifecycle = db.prepare(
    `INSERT INTO thread_lifecycle
             (thread_id, settled_at, snoozed_until, snoozed_at, muted_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(thread_id) DO UPDATE SET
             settled_at = excluded.settled_at,
             snoozed_until = excluded.snoozed_until,
             snoozed_at = excluded.snoozed_at,
             muted_at = excluded.muted_at,
             quiet_through = NULL,
             judged_through = NULL`,
  );

  const writeMany = (rows: StoredLifecycleRow[]) => {
    const insert = db.transaction((all: StoredLifecycleRow[]) => {
      for (const row of all) {
        upsertLifecycle.run(
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

  const decisionSettings = bb.settings.define({
    decisionEndpoint: {
      type: "string",
      label: "Decision model endpoint",
      description: "Keeps routine news on its shelf. Empty turns it off.",
      default: "",
    },
    decisionModel: {
      type: "string",
      label: "Decision model",
      default: DEFAULT_DECISION_MODEL,
    },
    decisionApiKey: {
      type: "string",
      label: "Decision model API key",
      description: "Optional.",
      secret: true,
    },
  });
  decisionSettings.onChange(() => {
    bb.realtime.publish(SETTINGS_CHANNEL, {});
  });

  let lastDecisionError: string | null = null;

  const readDecisionConfig = async () => {
    const values = await decisionSettings.get();
    return {
      endpoint: values.decisionEndpoint.trim(),
      model: values.decisionModel.trim() || DEFAULT_DECISION_MODEL,
      apiKey: values.decisionApiKey ?? "",
    };
  };

  const parkedSince = (row: StoredLifecycleRow, now: number): number | null => {
    if (row.mutedAt !== null) return null;
    if (row.snoozedUntil !== null) {
      return row.snoozedUntil > now ? row.snoozedAt : null;
    }
    return row.settledAt;
  };

  const askAboutMessage = async (
    title: string,
    message: string,
  ): Promise<Verdict & { model: string | null; answers: object }> => {
    const config = await readDecisionConfig();
    const { answers, model } = await askDecisionModel(config, {
      title,
      finalAssistantMessage: message.slice(0, MAX_JUDGED_MESSAGE_CHARS),
    });
    return { ...judgeAnswers(answers), model, answers };
  };

  const recordVerdict = (
    threadId: string,
    attentionAt: number,
    verdict: Verdict,
    detail: { model: string | null; answers: object | null },
  ) => {
    db.prepare(
      `UPDATE thread_lifecycle
          SET judged_through = MAX(COALESCE(judged_through, 0), ?),
              quiet_through = CASE WHEN ? THEN MAX(COALESCE(quiet_through, 0), ?)
                                   ELSE quiet_through END
        WHERE thread_id = ?`,
    ).run(attentionAt, verdict.quiet ? 1 : 0, attentionAt, threadId);
    db.prepare(
      `INSERT INTO decisions
         (thread_id, attention_at, quiet, reason, answers, model, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(thread_id, attention_at) DO NOTHING`,
    ).run(
      threadId,
      attentionAt,
      verdict.quiet ? 1 : 0,
      verdict.reason,
      detail.answers === null ? null : JSON.stringify(detail.answers),
      detail.model,
      Date.now(),
    );
    db.prepare(
      `DELETE FROM decisions WHERE rowid NOT IN
         (SELECT rowid FROM decisions ORDER BY decided_at DESC LIMIT ?)`,
    ).run(MAX_DECISION_LOG);
    bb.realtime.publish(LIFECYCLE_CHANNEL, { threadId });
  };

  const judgeNews = async (
    thread: { id: string; title?: string | null; latestAttentionAt: number },
    lastAssistantText: string | null,
  ) => {
    const { endpoint } = await readDecisionConfig();
    if (endpoint === "") return;
    const row = readRow(thread.id);
    if (row === undefined) return;
    const parkedAt = parkedSince(row, Date.now());
    const attentionAt = thread.latestAttentionAt;
    if (parkedAt === null || attentionAt <= parkedAt) return;
    const message = lastAssistantText?.trim() ?? "";
    let verdict: Verdict;
    let detail: { model: string | null; answers: object | null } = {
      model: null,
      answers: null,
    };
    if (message === "") {
      verdict = { quiet: false, reason: "no message to judge" };
    } else {
      try {
        const answer = await askAboutMessage(thread.title ?? "", message);
        verdict = answer;
        detail = { model: answer.model, answers: answer.answers };
        lastDecisionError = null;
      } catch (error) {
        lastDecisionError =
          error instanceof Error ? error.message : String(error);
        verdict = { quiet: false, reason: lastDecisionError };
      }
    }
    const current = readRow(thread.id);
    if (current === undefined || parkedSince(current, Date.now()) !== parkedAt) {
      return;
    }
    recordVerdict(thread.id, attentionAt, verdict, detail);
  };

  bb.rpc.register(bbSidebarRpcContract, {
    async getDecisionStatus() {
      const { endpoint } = await readDecisionConfig();
      const recent = (
        db
          .prepare(
            `SELECT thread_id, attention_at, quiet, reason, model, decided_at
               FROM decisions ORDER BY decided_at DESC LIMIT 50`,
          )
          .all() as {
          thread_id: string;
          attention_at: number;
          quiet: number;
          reason: string;
          model: string | null;
          decided_at: number;
        }[]
      ).map((row) => ({
        threadId: row.thread_id,
        attentionAt: row.attention_at,
        quiet: row.quiet === 1,
        reason: row.reason,
        model: row.model,
        decidedAt: row.decided_at,
      }));
      return { enabled: endpoint !== "", lastError: lastDecisionError, recent };
    },
    async testDecisionModel({ message, title }) {
      const answer = await askAboutMessage(title ?? "", message);
      return {
        quiet: answer.quiet,
        reason: answer.reason,
        model: answer.model,
        answers: { ...answer.answers },
      };
    },
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
            deleteLifecycle.run(threadId);
          } else {
            upsertLifecycle.run(
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
      const upsertImported = db.prepare(
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
      );
      const upsertLayout = db.prepare(
        `INSERT INTO layout_sets (set_name, items) VALUES (?, ?)
             ON CONFLICT(set_name) DO UPDATE SET items = excluded.items`,
      );
      const upsertSetting = db.prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      );
      const load = db.transaction(() => {
        for (const row of lifecycle) {
          upsertImported.run(
            row.threadId,
            row.settledAt,
            row.snoozedUntil,
            row.snoozedAt,
            row.mutedAt,
            row.pushLevelBeforeMute,
          );
        }
        for (const [set, items] of Object.entries(layout)) {
          upsertLayout.run(set, JSON.stringify(items));
        }
        for (const [key, value] of Object.entries(settings)) {
          upsertSetting.run(key, value);
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
      const alreadyMuted = readRow(threadId)?.mutedAt != null;
      write({
        threadId,
        settledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        mutedAt: Date.now(),
      });
      if (!alreadyMuted) {
        db.prepare(
          `UPDATE thread_lifecycle SET push_level_before_mute = ? WHERE thread_id = ?`,
        ).run(pushLevelBeforeMute ?? null, threadId);
      }
      return { ok: true };
    },
    async getMuteState({ threadId }) {
      const stored = db
        .prepare(
          `SELECT push_level_before_mute FROM thread_lifecycle WHERE thread_id = ?`,
        )
        .get(threadId) as { push_level_before_mute: string | null } | undefined;
      const parsed = pushLevelSchema.safeParse(stored?.push_level_before_mute);
      return { pushLevelBeforeMute: parsed.success ? parsed.data : null };
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
    forgetThread(thread.id);
  });

  bb.events.on("thread.archived", ({ thread }) => {
    forgetThread(thread.id);
  });

  bb.events.on("thread.idle", ({ thread, lastAssistantText }) => {
    void judgeNews(thread, lastAssistantText).catch(() => undefined);
  });
}
