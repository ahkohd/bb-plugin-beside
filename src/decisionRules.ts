export const QUIET_CONFIDENCE = 0.8;

export const NEEDS_YOU_SIGNALS = ["request", "user", "agent", "review"] as const;

export type NeedsYouSignalId = (typeof NEEDS_YOU_SIGNALS)[number];

export type DecisionLimits = Record<NeedsYouSignalId, number>;

const SIGNAL_QUESTIONS: Record<NeedsYouSignalId, string> = {
  request: "asks_user",
  user: "next_actor",
  agent: "next_actor",
  review: "worth_now",
};

export const NEEDS_YOU_LABELS: Record<NeedsYouSignalId, string> = {
  request: "Asks you for something",
  user: "You act next",
  agent: "Agent has more to do",
  review: "Worth reading now",
};

const REASONS: Record<NeedsYouSignalId, string> = {
  request: "asks you",
  user: "waits on you",
  agent: "agent has more to do",
  review: "worth reading now",
};

export const DECISION_PROVIDERS = ["off", "jev", "custom"] as const;

export type DecisionProvider = (typeof DECISION_PROVIDERS)[number];

export type ModelProvider = Exclude<DecisionProvider, "off">;

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";
export const SYSTEM_ONE_PATH = "/v1/systemone";

export const DEFAULT_LIMITS: Record<ModelProvider, DecisionLimits> = {
  jev: { request: 0.2, user: 0.5, agent: 0.5, review: 0.85 },
  custom: { request: 0.2, user: 0.5, agent: 0.5, review: 0.5 },
};

export const MIN_LIMIT = 0.05;
export const MAX_LIMIT = 0.95;

export type Sensitivity = "fewer" | "balanced" | "more";

const SENSITIVITY_SHIFT: Record<Sensitivity, number> = {
  fewer: 0.15,
  balanced: 0,
  more: -0.15,
};

function clampLimit(value: number): number {
  return Math.round(Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, value)) * 100) / 100;
}

export function limitsForSensitivity(
  provider: ModelProvider,
  sensitivity: Sensitivity,
): DecisionLimits {
  const shift = SENSITIVITY_SHIFT[sensitivity];
  const base = DEFAULT_LIMITS[provider];
  return {
    request: clampLimit(base.request + shift),
    user: clampLimit(base.user + shift),
    agent: clampLimit(base.agent + shift),
    review: clampLimit(base.review + shift),
  };
}

export function sameLimits(left: DecisionLimits, right: DecisionLimits): boolean {
  return NEEDS_YOU_SIGNALS.every(
    (signal) => Math.abs(left[signal] - right[signal]) < 0.005,
  );
}

export function sensitivityOf(
  provider: ModelProvider,
  limits: DecisionLimits,
): Sensitivity | null {
  const match = (["fewer", "balanced", "more"] as const).find((sensitivity) =>
    sameLimits(limitsForSensitivity(provider, sensitivity), limits),
  );
  return match ?? null;
}

export function providerOfModel(model: string | null): ModelProvider {
  return (model ?? "").toLowerCase().startsWith("jev") ? "jev" : "custom";
}

export function endpointFromAddress(address: string): string | null {
  const trimmed = address.trim();
  if (trimmed === "") return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.pathname === "/" || url.pathname === "") {
      url.pathname = SYSTEM_ONE_PATH;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export interface LooseAnswer {
  choice?: string;
  confidence?: number;
  probabilities?: Partial<Record<string, number>>;
}

export type LooseAnswers = Partial<Record<string, LooseAnswer>>;

export interface Verdict {
  quiet: boolean;
  reason: string;
}

export interface NeedsYouSignal {
  id: NeedsYouSignalId;
  label: string;
  probability: number;
  limit: number;
}

export function needsYouSignals(
  answers: LooseAnswers | null,
  limits: DecisionLimits,
): NeedsYouSignal[] {
  if (answers === null) return [];
  return NEEDS_YOU_SIGNALS.flatMap((id) => {
    const probability = answers[SIGNAL_QUESTIONS[id]]?.probabilities?.[id];
    if (typeof probability !== "number") return [];
    return [{ id, label: NEEDS_YOU_LABELS[id], probability, limit: limits[id] }];
  });
}

function exceedsLimit(
  answer: LooseAnswer | undefined,
  signal: NeedsYouSignalId,
  limit: number,
): boolean {
  if (answer === undefined) return true;
  const probability = answer.probabilities?.[signal];
  if (probability === undefined) return answer.choice === signal;
  return probability >= limit;
}

export function judgeAnswers(
  answers: LooseAnswers,
  limits: DecisionLimits = DEFAULT_LIMITS.custom,
): Verdict {
  for (const signal of NEEDS_YOU_SIGNALS) {
    if (exceedsLimit(answers[SIGNAL_QUESTIONS[signal]], signal, limits[signal])) {
      return { quiet: false, reason: REASONS[signal] };
    }
  }
  const unsure = Object.values(answers).some(
    (answer) =>
      answer !== undefined &&
      answer.probabilities === undefined &&
      (answer.confidence ?? 0) < QUIET_CONFIDENCE,
  );
  if (unsure) return { quiet: false, reason: "not confident" };
  return { quiet: true, reason: "can wait" };
}
