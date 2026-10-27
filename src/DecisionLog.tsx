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
import {
  SETTINGS_BADGE_CLASS,
  SETTINGS_BUTTON_CLASS,
  SegmentedControl,
  SettingsCard,
  SettingsGroup,
  SettingsRow,
} from "./settingsUi";

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


export function VerdictIcon({ quiet }: { quiet: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-card",
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
    return { dot: "bg-destructive", text: "Last request failed" };
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
    <SettingsCard>
      <SettingsRow
        label="Status"
        description={
          status.lastError ? (
            <span className="text-destructive-text">{status.lastError}</span>
          ) : status.enabled ? (
            `Using ${status.model}. Last ${judged} decisions below.`
          ) : (
            "Choose a decision model in Setup."
          )
        }
      >
        <span className="inline-flex items-center gap-1.5 text-xs text-foreground">
          <span className={cn("size-1.5 rounded-full", health.dot)} />
          {health.text}
        </span>
      </SettingsRow>
      {judged > 0 ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {stats.map((stat) => (
              <div key={stat.label} className="min-w-0">
                <p className="text-lg font-medium tabular-nums text-foreground">
                  {stat.value}
                </p>
                <p className="text-xs text-subtle-foreground">{stat.label}</p>
              </div>
            ))}
          </div>
          <div
            aria-hidden="true"
            className="flex h-1 overflow-hidden rounded-full bg-state-active"
          >
            <div
              className="h-full bg-muted-foreground/70"
              style={{ width: `${(parked / judged) * 100}%` }}
            />
          </div>
          {reasons.length > 0 ? (
            <p className="text-xs leading-snug text-subtle-foreground/75">
              Brought back for{" "}
              {reasons
                .map(([reason, count]) => `${reason.toLowerCase()} (${count})`)
                .join(", ")}
              .
            </p>
          ) : null}
        </div>
      ) : null}
    </SettingsCard>
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
          "flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors duration-150 hover:bg-state-hover hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
          open && "bg-state-hover",
        )}
      >
        <VerdictIcon quiet={decision.quiet} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-foreground">{title}</span>
          <span className="block truncate text-xs text-subtle-foreground">
            {headline(decision, limits)}
          </span>
        </span>
        <span className="shrink-0 text-xs tabular-nums text-subtle-foreground">
          {timeAgo(decision.decidedAt, now)}
        </span>
      </button>
      {open ? (
        <div className="space-y-3 px-3 pb-3 pl-12 pt-1">
          <SignalBars answers={decision.answers} limits={limits} />
          <div className="flex items-center gap-3">
            <button
              type="button"
              className={SETTINGS_BUTTON_CLASS}
              onClick={() => navigate.toThread(decision.threadId)}
            >
              Open thread
            </button>
            {decision.model ? (
              <span className={SETTINGS_BADGE_CLASS}>{decision.model}</span>
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

  return (
    <SettingsCard>
      <div className="@container/settings w-full min-w-0">
        <div className="flex flex-col gap-2.5">
          <div>
            <label
              htmlFor="beside-try-message"
              className="text-sm font-normal text-foreground"
            >
              Try a message
            </label>
            <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
              {enabled
                ? "Paste an agent's last message to see whether it would stay parked."
                : "Choose a decision model in Setup first."}
            </p>
          </div>
          <textarea
            id="beside-try-message"
            value={message}
            disabled={!enabled}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="All tests pass. I pushed the fix to main."
            rows={4}
            className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              className={SETTINGS_BUTTON_CLASS}
              disabled={!enabled || checking || message.trim() === ""}
              onClick={() => void check()}
            >
              {checking ? "Checking" : "Check"}
            </button>
            {result ? (
              <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                <VerdictIcon quiet={result.quiet} />
                <span className="truncate">
                  {result.quiet
                    ? "Would stay parked"
                    : `Would come back: ${headline(result, limits)}`}
                </span>
              </span>
            ) : null}
            {error ? (
              <span className="text-xs text-destructive-text">{error}</span>
            ) : null}
          </div>
        </div>
      </div>
      {result ? <SignalBars answers={result.answers} limits={limits} /> : null}
    </SettingsCard>
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

  return (
    <SettingsGroup
      title="Recent decisions"
      action={
        status.recent.length > 0 ? (
          <SegmentedControl
            label="Show"
            value={filter}
            options={FILTERS}
            onChange={setFilter}
          />
        ) : null
      }
    >
      <div className="overflow-hidden rounded-md border border-border bg-surface-recessed/70">
        {shown.length === 0 ? (
          <p className="px-3 py-3 text-xs text-subtle-foreground/75">
            {status.recent.length === 0
              ? "No decisions yet. One appears here each time a snoozed or settled thread finishes a turn."
              : `None in the last ${status.recent.length} decisions.`}
          </p>
        ) : (
          <ul className="divide-y divide-border">
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
    </SettingsGroup>
  );
}
