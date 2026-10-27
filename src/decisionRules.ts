export const QUIET_CONFIDENCE = 0.8;

export const QUIET_CEILINGS = {
  asks_user: { request: 0.2 },
  next_actor: { user: 0.5, agent: 0.5 },
  worth_now: { review: 0.5 },
} as const;

export const NEEDS_YOU_LABELS = {
  request: "Asks you for something",
  user: "You act next",
  agent: "Agent has more to do",
  review: "Worth reading now",
} as const;
