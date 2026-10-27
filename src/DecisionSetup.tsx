import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { bbSidebarRpcContract } from "./server";
import {
  DEFAULT_LIMITS,
  endpointFromAddress,
  judgeAnswers,
  JEV_ENDPOINT,
  JEV_MODEL,
  limitsForSensitivity,
  MAX_LIMIT,
  MIN_LIMIT,
  NEEDS_YOU_LABELS,
  NEEDS_YOU_SIGNALS,
  providerOfModel,
  sameLimits,
  sensitivityOf,
  type DecisionLimits,
  type DecisionProvider,
  type LooseAnswers,
  type ModelProvider,
  type Sensitivity,
} from "./decisionRules";
import { BUTTON_CLASS, type Decision } from "./DecisionLog";
import type { DecisionConfig } from "./useDecisionConfig";
import { cn } from "./lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/Select";

const PRIMARY_BUTTON_CLASS =
  "inline-flex h-7 shrink-0 items-center rounded-md bg-primary px-2.5 text-sm text-primary-foreground outline-none ring-sidebar-ring hover:opacity-90 focus-visible:ring-2 disabled:opacity-50";

const INPUT_CLASS =
  "h-8 w-full rounded-md border border-border bg-transparent px-2.5 text-sm text-foreground outline-none ring-sidebar-ring placeholder:text-subtle-foreground focus-visible:ring-2";

const PROVIDER_OPTIONS: {
  value: DecisionProvider;
  title: string;
  detail: string;
}[] = [
  {
    value: "off",
    title: "Off",
    detail: "Every thread with news comes back, as without decision mode.",
  },
  {
    value: "d1",
    title: "Liquid d1",
    detail: "Self-hosted, no key. Messages stay on your machines.",
  },
  {
    value: "jev",
    title: "TypeSafe Jev",
    detail: "Hosted, needs an API key. Messages are sent to TypeSafe.",
  },
  {
    value: "custom",
    title: "Custom",
    detail: "Any System One decision API, at an endpoint you give.",
  },
];

const SENSITIVITY_OPTIONS: {
  value: Sensitivity;
  title: string;
  detail: string;
}[] = [
  { value: "fewer", title: "Less", detail: "Only clear asks and failures come back." },
  {
    value: "balanced",
    title: "Balanced",
    detail: "Tuned on test messages for this model.",
  },
  {
    value: "more",
    title: "More",
    detail: "Anything that might need you comes back.",
  },
];

const PROVIDER_NAMES: Record<ModelProvider, string> = {
  d1: "d1",
  jev: "Jev",
  custom: "your model",
};

type Rpc = ReturnType<typeof useRpc<typeof bbSidebarRpcContract>>;

interface ConnectionResult {
  ok: boolean;
  model: string | null;
  ms: number | null;
  error: string | null;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function ConnectionLine({ result }: { result: ConnectionResult | "checking" | null }) {
  if (result === null) return null;
  if (result === "checking") {
    return <span className="text-sm text-muted-foreground">Checking</span>;
  }
  return result.ok ? (
    <span className="flex items-center gap-2 text-sm text-foreground">
      <span className="size-2 rounded-full bg-success" />
      Connected to {result.model ?? "the model"}
      {result.ms === null ? "" : ` in ${result.ms} ms`}
    </span>
  ) : (
    <span className="text-sm text-destructive-text">{result.error}</span>
  );
}

function ProviderPicker({
  selected,
  active,
  onSelect,
}: {
  selected: DecisionProvider;
  active: DecisionProvider;
  onSelect: (provider: DecisionProvider) => void;
}) {
  const option = PROVIDER_OPTIONS.find((candidate) => candidate.value === selected);
  const activeTitle = PROVIDER_OPTIONS.find(
    (candidate) => candidate.value === active,
  )?.title;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-4">
        <span id="beside-decision-model-label" className="text-sm text-foreground">
          Model
        </span>
        <Select
          value={selected}
          onValueChange={(value) => onSelect(value as DecisionProvider)}
        >
          <SelectTrigger
            aria-labelledby="beside-decision-model-label"
            className="h-8 w-56 text-sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROVIDER_OPTIONS.map((candidate) => (
              <SelectItem key={candidate.value} value={candidate.value} className="text-sm">
                {candidate.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs text-muted-foreground">
        {option?.detail}
        {selected !== active && activeTitle ? ` Now using ${activeTitle}.` : ""}
      </p>
    </div>
  );
}

function ModelDetails({
  provider,
  config,
  rpc,
  onSaved,
}: {
  provider: Exclude<DecisionProvider, "off">;
  config: DecisionConfig;
  rpc: Rpc;
  onSaved: (next: DecisionConfig) => void;
}) {
  const [address, setAddress] = useState(config.address);
  const [endpoint, setEndpoint] = useState(config.customEndpoint);
  const [model, setModel] = useState(config.customModel);
  const [saving, setSaving] = useState(false);
  const [connection, setConnection] = useState<ConnectionResult | "checking" | null>(
    null,
  );

  useEffect(() => setConnection(null), [provider]);

  const isActive = config.provider === provider;
  const unchanged =
    isActive &&
    (provider !== "d1" || address.trim() === config.address) &&
    (provider !== "custom" ||
      (endpoint.trim() === config.customEndpoint && model.trim() === config.customModel));

  const check = async () => {
    setConnection("checking");
    try {
      setConnection(await rpc.call("checkDecisionConnection", {}));
    } catch (error) {
      setConnection({ ok: false, model: null, ms: null, error: errorText(error, "The check failed") });
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      onSaved(
        await rpc.call("setDecisionConfig", {
          provider,
          ...(provider === "d1" ? { address } : {}),
          ...(provider === "custom" ? { endpoint, model } : {}),
        }),
      );
      await check();
    } catch (error) {
      setConnection({ ok: false, model: null, ms: null, error: errorText(error, "Could not save") });
    } finally {
      setSaving(false);
    }
  };

  const d1Endpoint = endpointFromAddress(address);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      {provider === "d1" ? (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-foreground">Server address</span>
            <input
              className={INPUT_CLASS}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="localhost:30001"
              spellCheck={false}
            />
            <span className="text-xs text-muted-foreground">
              {d1Endpoint
                ? `The bb server will call ${d1Endpoint}`
                : "The machine and port where llama.cpp serves d1, as the bb server sees it."}
            </span>
          </label>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none text-foreground">
              How to run d1
            </summary>
            <div className="mt-2 flex flex-col gap-2">
              <p>
                Download d1-3B-Q8_0.gguf from LiquidAI/d1-3B-GGUF on Hugging Face,
                then start it with llama.cpp b11485 or later:
              </p>
              <code className="block rounded-md bg-state-active px-2 py-1.5 font-mono text-2xs text-foreground">
                llama-server --model d1-3B-Q8_0.gguf --alias d1-3B --host 0.0.0.0
                --port 30001
              </code>
              <p>
                It needs no API key. Make sure the bb server can reach that port.
              </p>
            </div>
          </details>
        </>
      ) : null}

      {provider === "jev" ? (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Endpoint</dt>
            <dd className="truncate text-foreground">{JEV_ENDPOINT}</dd>
            <dt className="text-muted-foreground">Model</dt>
            <dd className="text-foreground">{JEV_MODEL}</dd>
            <dt className="text-muted-foreground">API key</dt>
            <dd className={config.keySet ? "text-foreground" : "text-destructive-text"}>
              {config.keySet
                ? "Set"
                : "Not set. Get one at typesafe.ai, then paste it into Decision model API key above."}
            </dd>
          </dl>
          <p className="text-xs text-muted-foreground">
            Each parked thread's title and the agent's last message are sent to
            TypeSafe when the thread finishes a turn.
          </p>
        </>
      ) : null}

      {provider === "custom" ? (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-foreground">Endpoint URL</span>
            <input
              className={INPUT_CLASS}
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="https://example.com/v1/systemone"
              spellCheck={false}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-foreground">Model name</span>
            <input
              className={INPUT_CLASS}
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="jev-latest"
              spellCheck={false}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Uses Decision model API key above, if you set one.
          </p>
        </>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {unchanged ? (
          <button type="button" className={BUTTON_CLASS} onClick={() => void check()}>
            Check connection
          </button>
        ) : (
          <button
            type="button"
            className={PRIMARY_BUTTON_CLASS}
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? "Saving" : isActive ? "Save" : `Use ${PROVIDER_OPTIONS.find((option) => option.value === provider)?.title}`}
          </button>
        )}
        <ConnectionLine result={connection} />
      </div>
    </div>
  );
}

interface PreviewChange {
  decision: Decision;
  nowQuiet: boolean;
}

function previewWith(
  recent: readonly Decision[],
  provider: ModelProvider,
  saved: DecisionLimits,
  draft: DecisionLimits,
) {
  const judged = recent.filter(
    (decision) =>
      decision.answers !== null && providerOfModel(decision.model) === provider,
  );
  const verdicts = judged.map((decision) => {
    const answers = decision.answers as LooseAnswers;
    return {
      decision,
      before: judgeAnswers(answers, saved).quiet,
      after: judgeAnswers(answers, draft).quiet,
    };
  });
  return {
    judged: judged.length,
    quietBefore: verdicts.filter((verdict) => verdict.before).length,
    quietAfter: verdicts.filter((verdict) => verdict.after).length,
    changes: verdicts
      .filter((verdict) => verdict.before !== verdict.after)
      .map((verdict): PreviewChange => ({
        decision: verdict.decision,
        nowQuiet: verdict.after,
      })),
  };
}

function LimitSliders({
  limits,
  onChange,
}: {
  limits: DecisionLimits;
  onChange: (limits: DecisionLimits) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {NEEDS_YOU_SIGNALS.map((signal) => (
        <label key={signal} className="flex flex-col gap-1">
          <span className="flex justify-between text-xs">
            <span className="text-muted-foreground">{NEEDS_YOU_LABELS[signal]}</span>
            <span className="tabular-nums text-foreground">
              under {Math.round(limits[signal] * 100)}%
            </span>
          </span>
          <input
            type="range"
            min={MIN_LIMIT * 100}
            max={MAX_LIMIT * 100}
            step={5}
            value={Math.round(limits[signal] * 100)}
            onChange={(event) =>
              onChange({ ...limits, [signal]: Number(event.target.value) / 100 })
            }
            className="w-full accent-current text-muted-foreground"
          />
        </label>
      ))}
      <p className="text-2xs text-subtle-foreground">
        A thread stays parked only when every chance is under its limit. Raise
        a limit to let more stay parked.
      </p>
    </div>
  );
}

function Tuning({
  provider,
  config,
  recent,
  titleFor,
  rpc,
  onSaved,
}: {
  provider: ModelProvider;
  config: DecisionConfig;
  recent: readonly Decision[];
  titleFor: (decision: Decision) => string;
  rpc: Rpc;
  onSaved: (next: DecisionConfig) => void;
}) {
  const saved = config.limits[provider];
  const [draft, setDraft] = useState(saved);
  const [saving, setSaving] = useState(false);

  const savedKey = JSON.stringify(saved);
  useEffect(() => setDraft(JSON.parse(savedKey) as DecisionLimits), [savedKey]);

  const sensitivity = sensitivityOf(provider, draft);
  const dirty = !sameLimits(draft, saved);
  const preview = previewWith(recent, provider, saved, draft);
  const isDefault = sameLimits(draft, DEFAULT_LIMITS[provider]);

  const save = async () => {
    setSaving(true);
    try {
      onSaved(
        await rpc.call("setDecisionLimits", {
          provider,
          limits: isDefault ? null : draft,
        }),
      );
    } catch (error) {
      toast.error(errorText(error, "Could not save the limits"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm text-foreground">How much reaches your Inbox</h3>
        <p className="text-xs text-muted-foreground">
          Applies to {PROVIDER_NAMES[provider]}. Each model has its own limits.
        </p>
      </div>
      <div role="radiogroup" aria-label="How much reaches your Inbox" className="grid grid-cols-3 gap-2">
        {SENSITIVITY_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={sensitivity === option.value}
            onClick={() => setDraft(limitsForSensitivity(provider, option.value))}
            className={cn(
              "flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-left outline-none ring-sidebar-ring hover:bg-state-hover focus-visible:ring-2",
              sensitivity === option.value ? "border-foreground/60" : "border-border",
            )}
          >
            <span className="text-sm text-foreground">{option.title}</span>
            <span className="text-xs text-muted-foreground">{option.detail}</span>
          </button>
        ))}
      </div>
      {sensitivity === null ? (
        <p className="text-xs text-muted-foreground">Using your own limits.</p>
      ) : null}

      <details className="text-sm" open={sensitivity === null}>
        <summary className="cursor-pointer select-none text-xs text-foreground">
          Advanced
        </summary>
        <div className="mt-2">
          <LimitSliders limits={draft} onChange={setDraft} />
        </div>
      </details>

      {dirty ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          {preview.judged > 0 ? (
            <>
              <p className="text-sm text-foreground">
                Of your last {preview.judged} {PROVIDER_NAMES[provider]} verdicts,{" "}
                {preview.quietAfter} would stay parked instead of{" "}
                {preview.quietBefore}.
              </p>
              {preview.changes.length > 0 ? (
                <ul className="flex flex-col gap-0.5 text-xs">
                  {preview.changes.map((change) => (
                    <li
                      key={`${change.decision.threadId}:${change.decision.decidedAt}`}
                      className="flex justify-between gap-3"
                    >
                      <span className="truncate text-muted-foreground">
                        {titleFor(change.decision)}
                      </span>
                      <span className="shrink-0 text-foreground">
                        {change.nowQuiet ? "would stay parked" : "would come back"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No {PROVIDER_NAMES[provider]} verdicts yet to preview against.
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={PRIMARY_BUTTON_CLASS}
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? "Saving" : "Save limits"}
            </button>
            <button type="button" className={BUTTON_CLASS} onClick={() => setDraft(saved)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function DecisionSetup({
  config,
  recent,
  titleFor,
  onSaved,
}: {
  config: DecisionConfig;
  recent: readonly Decision[];
  titleFor: (decision: Decision) => string;
  onSaved: (next: DecisionConfig) => void;
}) {
  const rpc = useRpc<typeof bbSidebarRpcContract>();
  const [picked, setPicked] = useState<DecisionProvider | null>(null);
  const selected = picked ?? config.provider;

  const select = (provider: DecisionProvider) => {
    setPicked(provider === config.provider ? null : provider);
    if (provider !== "off" || config.provider === "off") return;
    void rpc
      .call("setDecisionConfig", { provider: "off" })
      .then(onSaved)
      .catch((error: unknown) =>
        toast.error(errorText(error, "Could not turn decision mode off")),
      );
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <ProviderPicker selected={selected} active={config.provider} onSelect={select} />
        {selected === "off" ? null : (
          <ModelDetails
            key={selected}
            provider={selected}
            config={config}
            rpc={rpc}
            onSaved={(next) => {
              setPicked(null);
              onSaved(next);
            }}
          />
        )}
      </div>
      {config.provider === "off" ? null : (
        <Tuning
          provider={config.provider}
          config={config}
          recent={recent}
          titleFor={titleFor}
          rpc={rpc}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
