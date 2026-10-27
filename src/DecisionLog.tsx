import { useCallback, useEffect, useMemo, useState } from "react";
import * as z from "zod/mini";
import {
  experimental_useSidebarThreads as useSidebarThreads,
  useBbNavigate,
  useRealtime,
  useRpc,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import type { bbSidebarRpcContract } from "./server";
import { LIFECYCLE_CHANNEL } from "./lifecycleStore";
import { SETTINGS_CHANNEL } from "./layoutSets";
import { NEEDS_YOU_LABELS, QUIET_CEILINGS } from "./decisionRules";
import { Icon } from "./components/Icon";
import { cn } from "./lib/utils";

interface Decision {
  threadId: string;
  title: string | null;
  quiet: boolean;
  reason: string;
  model: string | null;
  answers: Record<string, unknown> | null;
  decidedAt: number;
}

interface Status {
  enabled: boolean;
  model: string;
  lastError: string | null;
  recent: Decision[];
}

interface Check {
  quiet: boolean;
  reason: string;
  model: string | null;
  answers: Record<string, unknown>;
}

const probabilitiesSchema = z.object({
  probabilities: z.optional(z.record(z.string(), z.number())),
});

interface NeedsYouSignal {
  label: string;
  probability: number;
  ceiling: number;
}

function needsYouSignals(
  answers: Record<string, unknown> | null,
): NeedsYouSignal[] {
  if (answers === null) return [];
  return Object.entries(QUIET_CEILINGS).flatMap(([questionId, ceilings]) => {
    const parsed = probabilitiesSchema.safeParse(answers[questionId]);
    const probabilities = parsed.success ? parsed.data.probabilities : undefined;
    if (probabilities === undefined) return [];
    return Object.entries(ceilings).flatMap(([choice, ceiling]) => {
      const probability = probabilities[choice];
      if (probability === undefined) return [];
      return [
        {
          label: NEEDS_YOU_LABELS[choice as keyof typeof NEEDS_YOU_LABELS],
          probability,
          ceiling,
        },
      ];
    });
  });
}

function timeAgo(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function verdictLabel(quiet: boolean): string {
  return quiet ? "Stayed parked" : "Brought back";
}

const BUTTON_CLASS =
  "inline-flex h-7 shrink-0 items-center rounded-md border border-border px-2.5 text-sm text-foreground outline-none ring-sidebar-ring hover:bg-state-hover focus-visible:ring-2 active:bg-state-active disabled:opacity-50";

function SignalList({ answers }: { answers: Record<string, unknown> | null }) {
  const signals = needsYouSignals(answers);
  if (signals.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        The model gave no probabilities for this verdict.
      </p>
    );
  }
  return (
    <dl className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-0.5 text-xs">
      {signals.map((signal) => {
        const tooHigh = signal.probability >= signal.ceiling;
        return (
          <div key={signal.label} className="contents">
            <dt className="text-muted-foreground">{signal.label}</dt>
            <dd
              className={cn(
                "text-right tabular-nums",
                tooHigh ? "text-destructive-text" : "text-foreground",
              )}
            >
              {percent(signal.probability)}
            </dd>
            <dd className="text-right tabular-nums text-subtle-foreground">
              under {percent(signal.ceiling)} to stay parked
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function DecisionRow({
  decision,
  title,
  now,
}: {
  decision: Decision;
  title: string;
  now: number;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useBbNavigate();
  return (
    <li className="border-b border-border-hairline last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none ring-sidebar-ring hover:bg-state-hover focus-visible:ring-2"
      >
        <Icon
          name="ChevronRight"
          aria-hidden="true"
          className={cn(
            "size-3 shrink-0 text-subtle-foreground transition-transform duration-150",
            open && "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-foreground">
          {title}
        </span>
        <span
          className={cn(
            "shrink-0 text-xs",
            decision.quiet ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {verdictLabel(decision.quiet)}
        </span>
        <span className="w-14 shrink-0 text-right text-xs tabular-nums text-subtle-foreground">
          {timeAgo(decision.decidedAt, now)}
        </span>
      </button>
      {open ? (
        <div className="flex flex-col gap-2 px-7 pb-3 pt-1">
          <p className="text-xs text-muted-foreground">
            {decision.quiet ? "Can wait" : `Reason: ${decision.reason}`}
            {decision.model ? ` · ${decision.model}` : ""}
          </p>
          <SignalList answers={decision.answers} />
          <div>
            <button
              type="button"
              className={BUTTON_CLASS}
              onClick={() => navigate.toThread(decision.threadId)}
            >
              Open thread
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function TryAMessage({ enabled }: { enabled: boolean }) {
  const rpc = useRpc<typeof bbSidebarRpcContract>();
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<Check | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      setResult(await rpc.call("testDecisionModel", { message }));
    } catch (failure) {
      setResult(null);
      setError(
        failure instanceof Error ? failure.message : "The check failed",
      );
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor="beside-try-message"
        className="text-sm text-foreground"
      >
        Try a message
      </label>
      <textarea
        id="beside-try-message"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="Paste an agent's last message"
        rows={3}
        className="w-full resize-y rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm text-foreground outline-none ring-sidebar-ring placeholder:text-subtle-foreground focus-visible:ring-2"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          className={BUTTON_CLASS}
          disabled={!enabled || checking || message.trim() === ""}
          onClick={() => void check()}
        >
          {checking ? "Checking" : "Check"}
        </button>
        {result ? (
          <span className="text-sm text-foreground">
            {result.quiet
              ? "Would stay parked"
              : `Would come back: ${result.reason}`}
          </span>
        ) : null}
        {error ? (
          <span className="text-sm text-destructive-text">{error}</span>
        ) : null}
      </div>
      {result ? <SignalList answers={result.answers} /> : null}
    </div>
  );
}

export function DecisionLog() {
  const rpc = useRpc<typeof bbSidebarRpcContract>();
  const endpoint = useSettings().values?.decisionEndpoint;
  const [status, setStatus] = useState<Status | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { threads } = useSidebarThreads();
  const liveTitles = useMemo(
    () => new Map(threads.map((thread) => [thread.id, thread.displayTitle])),
    [threads],
  );

  const refresh = useCallback(async () => {
    setStatus(await rpc.call("getDecisionStatus", {}));
    setNow(Date.now());
  }, [rpc]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh, endpoint]);

  useRealtime(LIFECYCLE_CHANNEL, () => {
    void refresh().catch(() => undefined);
  });
  useRealtime(SETTINGS_CHANNEL, () => {
    void refresh().catch(() => undefined);
  });

  if (status === null) return null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1 text-sm">
        <p className="text-foreground">
          {status.enabled
            ? `On, using ${status.model}.`
            : "Off. Set Decision model endpoint above to turn it on."}
        </p>
        {status.lastError ? (
          <p className="text-destructive-text">
            Last request failed: {status.lastError}
          </p>
        ) : null}
      </div>

      <TryAMessage enabled={status.enabled} />

      <div className="flex flex-col gap-2">
        <h3 className="text-sm text-foreground">Recent decisions</h3>
        {status.recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            None yet. A decision appears here when a snoozed or settled thread
            finishes a turn.
          </p>
        ) : (
          <ul className="flex flex-col">
            {status.recent.map((decision) => (
              <DecisionRow
                key={`${decision.threadId}:${decision.decidedAt}`}
                decision={decision}
                title={
                  liveTitles.get(decision.threadId) ||
                  decision.title ||
                  "Untitled thread"
                }
                now={now}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
