import { useState } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { bbSidebarRpcContract } from "./server";
import {
  needsYouSignals,
  providerOfModel,
  type DecisionLimits,
  type DecisionProvider,
  type LooseAnswers,
  type ModelProvider,
  type NeedsYouSignal,
} from "./decisionRules";
import { Icon } from "./components/Icon";
import { cn } from "./lib/utils";

export interface Decision {
  threadId: string;
  title: string | null;
  quiet: boolean;
  reason: string;
  model: string | null;
  answers: Record<string, unknown> | null;
  decidedAt: number;
}

export interface Status {
  enabled: boolean;
  provider: DecisionProvider;
  model: string;
  lastError: string | null;
  recent: Decision[];
}

interface Verdict {
  quiet: boolean;
  reason: string;
  answers: Record<string, unknown> | null;
}

type VerdictFilter = "all" | "parked" | "back";

const FILTERS: { value: VerdictFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "parked", label: "Stayed parked" },
  { value: "back", label: "Brought back" },
];

export type LimitsByProvider = Record<ModelProvider, DecisionLimits>;

export function limitsForModel(
  limits: LimitsByProvider,
  model: string | null,
): DecisionLimits {
  return limits[providerOfModel(model)];
}

function isOverLimit(signal: NeedsYouSignal): boolean {
  return signal.probability >= signal.limit;
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function headline(verdict: Verdict, limits: DecisionLimits): string {
  if (verdict.quiet) return "Can wait";
  const deciding = needsYouSignals(
    verdict.answers as LooseAnswers | null,
    limits,
  ).find(isOverLimit);
  return deciding
    ? `${deciding.label} ${percent(deciding.probability)}`
    : sentenceCase(verdict.reason);
}

function timeAgo(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function countReasons(decisions: readonly Decision[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const decision of decisions) {
    if (decision.quiet) continue;
    const reason = sentenceCase(decision.reason);
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts].sort((left, right) => right[1] - left[1]);
}

export const BUTTON_CLASS =
  "inline-flex h-7 shrink-0 items-center rounded-md border border-border px-2.5 text-sm text-foreground outline-none ring-sidebar-ring hover:bg-state-hover focus-visible:ring-2 active:bg-state-active disabled:opacity-50";

export function VerdictIcon({ quiet }: { quiet: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-state-active",
        quiet ? "text-muted-foreground" : "text-foreground",
      )}
    >
      <Icon
        name={quiet ? "NotificationOff" : "Notification"}
        aria-label={quiet ? "Stayed parked" : "Brought back"}
        className="size-3.5"
      />
    </span>
  );
}

function SignalBars({
  answers,
  limits,
}: {
  answers: Record<string, unknown> | null;
  limits: DecisionLimits;
}) {
  const signals = needsYouSignals(answers as LooseAnswers | null, limits);
  if (signals.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        The model gave no probabilities for this verdict.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {signals.map((signal) => {
        const over = isOverLimit(signal);
        return (
          <div key={signal.label} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between text-xs">
              <span
                className={over ? "text-foreground" : "text-muted-foreground"}
              >
                {signal.label}
              </span>
              <span
                className={cn(
                  "tabular-nums",
                  over ? "text-destructive-text" : "text-muted-foreground",
                )}
              >
                {percent(signal.probability)}
              </span>
            </div>
            <div
              role="meter"
              aria-label={signal.label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(signal.probability * 100)}
              className="relative h-1.5 rounded-full bg-state-active"
            >
              <div
                className={cn(
                  "h-full rounded-full",
                  over ? "bg-destructive" : "bg-muted-foreground/60",
                )}
                style={{ width: `${Math.max(2, signal.probability * 100)}%` }}
              />
              <div
                title={`Stays parked under ${percent(signal.limit)}`}
                className="absolute -top-0.5 h-2.5 w-px bg-foreground/70"
                style={{ left: `${signal.limit * 100}%` }}
              />
            </div>
          </div>
        );
      })}
      <p className="text-2xs text-subtle-foreground">
        The tick on each bar is the limit. A thread stays parked only when every
        bar is under its tick.
      </p>
    </div>
  );
}

function healthOf(status: Status): { dot: string; text: string } {
  if (!status.enabled) return { dot: "bg-subtle-foreground", text: "Off" };
  if (status.lastError) {
    return { dot: "bg-destructive", text: "On, but the last request failed" };
  }
  return { dot: "bg-success", text: "On" };
}

export function Summary({ status }: { status: Status }) {
  const judged = status.recent.length;
  const parked = status.recent.filter((decision) => decision.quiet).length;
  const reasons = countReasons(status.recent);
  const health = healthOf(status);
  const stats = [
    { label: "Judged", value: judged },
    { label: "Stayed parked", value: parked },
    { label: "Brought back", value: judged - parked },
  ];

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex items-center gap-2 text-sm">
        <span className={cn("size-2 shrink-0 rounded-full", health.dot)} />
        <span className="text-foreground">{health.text}</span>
        <span className="truncate text-muted-foreground">
          {status.enabled
            ? `· ${status.model}`
            : "· choose a model above"}
        </span>
      </div>
      {status.lastError ? (
        <p className="text-xs text-destructive-text">{status.lastError}</p>
      ) : null}
      {judged > 0 ? (
        <>
          <div className="grid grid-cols-3 gap-3">
            {stats.map((stat) => (
              <div key={stat.label} className="flex flex-col">
                <span className="text-xl tabular-nums text-foreground">
                  {stat.value}
                </span>
                <span className="text-xs text-muted-foreground">
                  {stat.label}
                </span>
              </div>
            ))}
          </div>
          <div
            aria-hidden="true"
            className="flex h-1.5 overflow-hidden rounded-full bg-state-active"
          >
            <div
              className="h-full bg-muted-foreground/60"
              style={{ width: `${(parked / judged) * 100}%` }}
            />
          </div>
          {reasons.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Brought back for:{" "}
              {reasons
                .map(([reason, count]) => `${reason} (${count})`)
                .join(", ")}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function DecisionRow({
  decision,
  title,
  limits,
  now,
}: {
  decision: Decision;
  title: string;
  limits: DecisionLimits;
  now: number;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useBbNavigate();
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left outline-none ring-sidebar-ring hover:bg-state-hover focus-visible:ring-2",
          open && "bg-state-hover",
        )}
      >
        <VerdictIcon quiet={decision.quiet} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm text-foreground">{title}</span>
          <span className="truncate text-xs text-muted-foreground">
            {headline(decision, limits)}
          </span>
        </span>
        <span className="shrink-0 text-xs tabular-nums text-subtle-foreground">
          {timeAgo(decision.decidedAt, now)}
        </span>
      </button>
      {open ? (
        <div className="flex flex-col gap-3 py-2 pl-11 pr-2">
          <SignalBars answers={decision.answers} limits={limits} />
          <div className="flex items-center gap-3">
            <button
              type="button"
              className={BUTTON_CLASS}
              onClick={() => navigate.toThread(decision.threadId)}
            >
              Open thread
            </button>
            {decision.model ? (
              <span className="text-xs text-subtle-foreground">
                {decision.model}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function TryAMessage({
  enabled,
  limits,
}: {
  enabled: boolean;
  limits: DecisionLimits;
}) {
  const rpc = useRpc<typeof bbSidebarRpcContract>();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<Verdict | null>(null);
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

  if (!open) {
    return (
      <div>
        <button
          type="button"
          className={BUTTON_CLASS}
          disabled={!enabled}
          onClick={() => setOpen(true)}
        >
          Try a message
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <label htmlFor="beside-try-message" className="text-sm text-foreground">
        Try a message
      </label>
      <textarea
        id="beside-try-message"
        autoFocus
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
          <span className="flex items-center gap-2 text-sm text-foreground">
            <VerdictIcon quiet={result.quiet} />
            {result.quiet
              ? "Would stay parked"
              : `Would come back: ${headline(result, limits)}`}
          </span>
        ) : null}
        {error ? (
          <span className="text-sm text-destructive-text">{error}</span>
        ) : null}
      </div>
      {result ? <SignalBars answers={result.answers} limits={limits} /> : null}
    </div>
  );
}

function matchesFilter(decision: Decision, filter: VerdictFilter): boolean {
  if (filter === "parked") return decision.quiet;
  if (filter === "back") return !decision.quiet;
  return true;
}

export function DecisionLog({
  status,
  limits,
  titleFor,
}: {
  status: Status;
  limits: LimitsByProvider;
  titleFor: (decision: Decision) => string;
}) {
  const [filter, setFilter] = useState<VerdictFilter>("all");
  const now = Date.now();
  const shown = status.recent.filter((decision) =>
    matchesFilter(decision, filter),
  );

  if (status.recent.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No decisions yet. One appears here each time a snoozed or settled
        thread finishes a turn.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm text-foreground">Recent decisions</h3>
        <div role="radiogroup" aria-label="Show" className="flex gap-1">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={filter === option.value}
              onClick={() => setFilter(option.value)}
              className={cn(
                "h-7 rounded-md px-2.5 text-xs outline-none ring-sidebar-ring focus-visible:ring-2",
                filter === option.value
                  ? "bg-state-active text-foreground"
                  : "text-muted-foreground hover:bg-state-hover",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="px-2 py-1.5 text-sm text-muted-foreground">
          None in the last {status.recent.length} decisions.
        </p>
      ) : (
        <ul className="flex flex-col gap-px">
          {shown.map((decision) => (
            <DecisionRow
              key={`${decision.threadId}:${decision.decidedAt}`}
              decision={decision}
              title={titleFor(decision)}
              limits={limitsForModel(limits, decision.model)}
              now={now}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
