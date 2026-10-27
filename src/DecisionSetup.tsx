import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { bbSidebarRpcContract } from "./server";
import {
  DEFAULT_LIMITS,
  judgeAnswers,
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
import type { Decision } from "./DecisionLog";
import type { DecisionConfig } from "./useDecisionConfig";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/Select";
import {
  SETTINGS_BADGE_CLASS,
  SETTINGS_BUTTON_CLASS,
  SETTINGS_INPUT_CLASS,
  SETTINGS_PRIMARY_BUTTON_CLASS,
  SETTINGS_SELECT_TRIGGER_CLASS,
  SettingsCard,
  SettingsGroup,
  SettingsRow,
} from "./settingsUi";

const PROVIDER_OPTIONS: {
  value: DecisionProvider;
  title: string;
  detail: string;
}[] = [
  {
    value: "off",
    title: "Off",
    detail: "Every thread with news comes back to the Inbox.",
  },
  {
    value: "jev",
    title: "TypeSafe Jev",
    detail: "TypeSafe's hosted model. Messages are sent to TypeSafe.",
  },
  {
    value: "custom",
    title: "Custom",
    detail: "Any System One decision API, such as a self-hosted Liquid d1.",
  },
];

type SensitivityChoice = Sensitivity | "custom";

const SENSITIVITY_OPTIONS: {
  value: SensitivityChoice;
  title: string;
  detail: string;
}[] = [
  {
    value: "fewer",
    title: "Less",
    detail: "Only clear asks and failures come back.",
  },
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
  {
    value: "custom",
    title: "Custom",
    detail: "Set the limit for each chance yourself.",
  },
];

const PROVIDER_NAMES: Record<ModelProvider, string> = {
  jev: "Jev",
  custom: "your custom model",
};

type Rpc = ReturnType<typeof useRpc<typeof bbSidebarRpcContract>>;

interface ConnectionResult {
  ok: boolean;
  model: string | null;
  ms: number | null;
  error: string | null;
}

type ConnectionState = ConnectionResult | "checking" | null;

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function titleOf(provider: DecisionProvider): string {
  return (
    PROVIDER_OPTIONS.find((option) => option.value === provider)?.title ??
    provider
  );
}

function ConnectionDescription({ state }: { state: ConnectionState }) {
  if (state === null) return <>Send one test message to the model.</>;
  if (state === "checking") return <>Checking</>;
  if (!state.ok) {
    return <span className="text-destructive-text">{state.error}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-foreground">
      <span className="size-1.5 rounded-full bg-success" />
      Connected to {state.model ?? "the model"}
      {state.ms === null ? "" : ` in ${state.ms} ms`}
    </span>
  );
}

function ApiKeyInput({
  isSet,
  value,
  onChange,
  required,
}: {
  isSet: boolean;
  value: string;
  onChange: (value: string) => void;
  required: boolean;
}) {
  return (
    <input
      type="password"
      autoComplete="off"
      aria-label="API key"
      className={SETTINGS_INPUT_CLASS}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={isSet ? "[set]" : required ? "Paste your key" : "Optional"}
    />
  );
}

function ModelRows({
  provider,
  config,
  rpc,
  onSaved,
}: {
  provider: ModelProvider;
  config: DecisionConfig;
  rpc: Rpc;
  onSaved: (next: DecisionConfig) => void;
}) {
  const [endpoint, setEndpoint] = useState(config.customEndpoint);
  const [model, setModel] = useState(config.customModel);
  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [showD1Guide, setShowD1Guide] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>(null);

  const keyIsSet = config.keys[provider];
  const keyChanged = apiKey.trim() !== "" || clearKey;
  const isActive = config.provider === provider;
  const unchanged =
    isActive &&
    !keyChanged &&
    (provider !== "custom" ||
      (endpoint.trim() === config.customEndpoint &&
        model.trim() === config.customModel));

  const check = async () => {
    setConnection("checking");
    try {
      setConnection(await rpc.call("checkDecisionConnection", {}));
    } catch (error) {
      setConnection({
        ok: false,
        model: null,
        ms: null,
        error: errorText(error, "The check failed"),
      });
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      onSaved(
        await rpc.call("setDecisionConfig", {
          provider,
          ...(provider === "custom" ? { endpoint, model } : {}),
          ...(keyChanged ? { apiKey: clearKey ? null : apiKey } : {}),
        }),
      );
      setApiKey("");
      setClearKey(false);
      await check();
    } catch (error) {
      setConnection({
        ok: false,
        model: null,
        ms: null,
        error: errorText(error, "Could not save"),
      });
    } finally {
      setSaving(false);
    }
  };

  const keyDescription =
    provider === "jev"
      ? keyIsSet
        ? "Stored on the bb server. Paste a new key to replace it."
        : "Get a key at typesafe.ai. It is stored on the bb server and never shown again."
      : keyIsSet
        ? "Sent as a bearer token. Paste a new key to replace it."
        : "Sent as a bearer token. Leave it empty if your model needs none.";

  return (
    <>
      {provider === "jev" ? (
        <SettingsRow
          label="Endpoint"
          description="Each parked thread's title and the agent's last message are sent to TypeSafe."
        >
          <span className="text-xs text-muted-foreground">api.typesafe.ai</span>
        </SettingsRow>
      ) : (
        <>
          <SettingsRow
            label="Endpoint"
            description={
              <>
                The URL the bb server calls. A host and port, such as
                localhost:30001, gets /v1/systemone added.{" "}
                <button
                  type="button"
                  className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={() => setShowD1Guide((value) => !value)}
                >
                  {showD1Guide ? "Hide example" : "Self-host Liquid d1"}
                </button>
                {showD1Guide ? (
                  <span className="mt-2 block space-y-1.5">
                    <span className="block">
                      Download d1-3B-Q8_0.gguf from LiquidAI/d1-3B-GGUF on
                      Hugging Face and serve it with llama.cpp b11485 or later.
                      Then use localhost:30001 and the model name d1-3B, with
                      no key.
                    </span>
                    <code className="block rounded-md border border-border bg-card px-2 py-1.5 font-mono text-2xs text-foreground">
                      llama-server --model d1-3B-Q8_0.gguf --alias d1-3B
                      --host 0.0.0.0 --port 30001
                    </code>
                  </span>
                ) : null}
              </>
            }
          >
            <input
              aria-label="Endpoint"
              className={SETTINGS_INPUT_CLASS}
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="http://localhost:30001/v1/systemone"
              spellCheck={false}
            />
          </SettingsRow>
          <SettingsRow
            label="Model name"
            description="The name your endpoint expects."
          >
            <input
              aria-label="Model name"
              className={SETTINGS_INPUT_CLASS}
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="d1-3B"
              spellCheck={false}
            />
          </SettingsRow>
        </>
      )}

      <SettingsRow
        label="API key"
        badge={<span className={SETTINGS_BADGE_CLASS}>secret</span>}
        description={keyDescription}
      >
        {keyIsSet && provider === "custom" ? (
          <button
            type="button"
            className={SETTINGS_BUTTON_CLASS}
            aria-pressed={clearKey}
            onClick={() => {
              setClearKey((value) => !value);
              setApiKey("");
            }}
          >
            {clearKey ? "Keep key" : "Remove"}
          </button>
        ) : null}
        {clearKey ? null : (
          <ApiKeyInput
            isSet={keyIsSet}
            value={apiKey}
            onChange={setApiKey}
            required={provider === "jev"}
          />
        )}
      </SettingsRow>

      <SettingsRow
        label="Connection"
        description={<ConnectionDescription state={connection} />}
      >
        {unchanged ? (
          <button
            type="button"
            className={SETTINGS_BUTTON_CLASS}
            disabled={connection === "checking"}
            onClick={() => void check()}
          >
            Check connection
          </button>
        ) : (
          <button
            type="button"
            className={SETTINGS_PRIMARY_BUTTON_CLASS}
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? "Saving" : isActive ? "Save" : `Use ${titleOf(provider)}`}
          </button>
        )}
      </SettingsRow>
    </>
  );
}

function previewWith(
  recent: readonly Decision[],
  provider: ModelProvider,
  saved: DecisionLimits,
  draft: DecisionLimits,
) {
  const verdicts = recent
    .filter(
      (decision) =>
        decision.answers !== null &&
        providerOfModel(decision.model) === provider,
    )
    .map((decision) => {
      const answers = decision.answers as LooseAnswers;
      return {
        decision,
        before: judgeAnswers(answers, saved).quiet,
        after: judgeAnswers(answers, draft).quiet,
      };
    });
  return {
    judged: verdicts.length,
    quietBefore: verdicts.filter((verdict) => verdict.before).length,
    quietAfter: verdicts.filter((verdict) => verdict.after).length,
    changes: verdicts.filter((verdict) => verdict.before !== verdict.after),
  };
}

function SensitivityRows({
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
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState(saved);
  const [wantsCustom, setWantsCustom] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(JSON.parse(savedKey) as DecisionLimits);
    setWantsCustom(false);
  }, [savedKey]);

  const preset = sensitivityOf(provider, draft);
  const choice: SensitivityChoice =
    wantsCustom || preset === null ? "custom" : preset;
  const dirty = !sameLimits(draft, saved);
  const preview = previewWith(recent, provider, saved, draft);
  const detail = SENSITIVITY_OPTIONS.find((option) => option.value === choice)
    ?.detail;

  const choose = (next: SensitivityChoice) => {
    if (next === "custom") {
      setWantsCustom(true);
      return;
    }
    setWantsCustom(false);
    setDraft(limitsForSensitivity(provider, next));
  };

  const save = async () => {
    setSaving(true);
    try {
      onSaved(
        await rpc.call("setDecisionLimits", {
          provider,
          limits: sameLimits(draft, DEFAULT_LIMITS[provider]) ? null : draft,
        }),
      );
    } catch (error) {
      toast.error(errorText(error, "Could not save the limits"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SettingsRow
        label="How much reaches your Inbox"
        labelId="beside-sensitivity-label"
        description={`${detail} Applies to ${PROVIDER_NAMES[provider]}; each model keeps its own.`}
      >
        <Select
          value={choice}
          onValueChange={(value) => choose(value as SensitivityChoice)}
        >
          <SelectTrigger
            aria-labelledby="beside-sensitivity-label"
            className={SETTINGS_SELECT_TRIGGER_CLASS}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SENSITIVITY_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value} className="text-xs">
                {option.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>

      {choice === "custom"
        ? NEEDS_YOU_SIGNALS.map((signal) => (
            <SettingsRow
              key={signal}
              label={NEEDS_YOU_LABELS[signal]}
              description={`Stays parked while the chance is under ${Math.round(draft[signal] * 100)}%.`}
            >
              <input
                type="range"
                aria-label={NEEDS_YOU_LABELS[signal]}
                min={MIN_LIMIT * 100}
                max={MAX_LIMIT * 100}
                step={5}
                value={Math.round(draft[signal] * 100)}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    [signal]: Number(event.target.value) / 100,
                  })
                }
                className="w-full accent-foreground @min-[36rem]/settings:w-44"
              />
            </SettingsRow>
          ))
        : null}

      {dirty ? (
        <SettingsRow
          label="Preview"
          description={
            preview.judged === 0 ? (
              `No verdicts from ${PROVIDER_NAMES[provider]} yet to preview against.`
            ) : (
              <>
                Of the last {preview.judged} verdicts from{" "}
                {PROVIDER_NAMES[provider]},{" "}
                {preview.quietAfter} would stay parked instead of{" "}
                {preview.quietBefore}.
                {preview.changes.length > 0 ? (
                  <span className="mt-1.5 block space-y-0.5">
                    {preview.changes.map(({ decision, after }) => (
                      <span
                        key={`${decision.threadId}:${decision.decidedAt}`}
                        className="flex justify-between gap-3"
                      >
                        <span className="truncate">{titleFor(decision)}</span>
                        <span className="shrink-0 text-foreground">
                          {after ? "would stay parked" : "would come back"}
                        </span>
                      </span>
                    ))}
                  </span>
                ) : null}
              </>
            )
          }
        >
          <button
            type="button"
            className={SETTINGS_BUTTON_CLASS}
            onClick={() => {
              setDraft(saved);
              setWantsCustom(false);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className={SETTINGS_PRIMARY_BUTTON_CLASS}
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? "Saving" : "Save limits"}
          </button>
        </SettingsRow>
      ) : null}
    </>
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
  const option = PROVIDER_OPTIONS.find((candidate) => candidate.value === selected);

  const select = (provider: DecisionProvider) => {
    setPicked(provider === config.provider ? null : provider);
    if (provider !== "off" || config.provider === "off") return;
    void rpc
      .call("setDecisionConfig", { provider: "off" })
      .then((next) => {
        setPicked(null);
        onSaved(next);
      })
      .catch((error: unknown) =>
        toast.error(errorText(error, "Could not turn decision mode off")),
      );
  };

  return (
    <div className="space-y-6">
      <SettingsGroup title="Model">
        <SettingsCard>
          <SettingsRow
            label="Decision model"
            labelId="beside-decision-model-label"
            description={
              selected !== config.provider
                ? `${option?.detail} Still using ${titleOf(config.provider)} until you save.`
                : option?.detail
            }
          >
            <Select
              value={selected}
              onValueChange={(value) => select(value as DecisionProvider)}
            >
              <SelectTrigger
                aria-labelledby="beside-decision-model-label"
                className={SETTINGS_SELECT_TRIGGER_CLASS}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_OPTIONS.map((candidate) => (
                  <SelectItem
                    key={candidate.value}
                    value={candidate.value}
                    className="text-xs"
                  >
                    {candidate.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>
          {selected === "off" ? null : (
            <ModelRows
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
        </SettingsCard>
      </SettingsGroup>

      {config.provider === "off" ? null : (
        <SettingsGroup title="Sensitivity">
          <SettingsCard>
            <SensitivityRows
              provider={config.provider}
              config={config}
              recent={recent}
              titleFor={titleFor}
              rpc={rpc}
              onSaved={onSaved}
            />
          </SettingsCard>
        </SettingsGroup>
      )}
    </div>
  );
}
