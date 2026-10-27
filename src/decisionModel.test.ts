import { describe, expect, it } from "vitest";
import { judgeAnswers, type DecisionAnswers } from "./decisionModel";

const answers = (
  asks: DecisionAnswers["asks_user"]["choice"],
  next: DecisionAnswers["next_actor"]["choice"],
  worth: DecisionAnswers["worth_now"]["choice"],
  confidence = 0.9,
): DecisionAnswers => ({
  asks_user: { choice: asks, confidence },
  next_actor: { choice: next, confidence },
  worth_now: { choice: worth, confidence },
});

describe("judgeAnswers", () => {
  it("lets routine finished work wait", () => {
    expect(judgeAnswers(answers("report", "nobody", "fyi")).quiet).toBe(true);
    expect(judgeAnswers(answers("report", "running", "fyi")).quiet).toBe(true);
  });

  it("brings back anything that needs the user", () => {
    expect(judgeAnswers(answers("request", "nobody", "fyi")).quiet).toBe(false);
    expect(judgeAnswers(answers("report", "user", "fyi")).quiet).toBe(false);
    expect(judgeAnswers(answers("report", "nobody", "review")).quiet).toBe(false);
    expect(judgeAnswers(answers("report", "agent", "fyi")).quiet).toBe(false);
  });

  it("brings back news it is unsure about", () => {
    expect(judgeAnswers(answers("report", "nobody", "fyi", 0.6))).toEqual({
      quiet: false,
      reason: "not confident",
    });
  });
});

describe("judgeAnswers with probabilities", () => {
  const withProbabilities = (
    request: number,
    next: Record<string, number>,
    review: number,
  ): DecisionAnswers => ({
    asks_user: {
      choice: request >= 0.5 ? "request" : "report",
      confidence: 0.9,
      probabilities: { request, report: 1 - request },
    },
    next_actor: { choice: "nobody", confidence: 0.2, probabilities: next },
    worth_now: {
      choice: review >= 0.5 ? "review" : "fyi",
      confidence: 0.1,
      probabilities: { review, fyi: 1 - review },
    },
  });

  it("lets low-confidence routine news wait when no need-you choice is likely", () => {
    expect(
      judgeAnswers(
        withProbabilities(0.01, { user: 0.4, agent: 0.1, running: 0.46, nobody: 0.04 }, 0.08),
      ).quiet,
    ).toBe(true);
  });

  it("brings back news likely to need review even when fyi was chosen", () => {
    expect(
      judgeAnswers(
        withProbabilities(0.01, { user: 0.41, agent: 0.03, running: 0.03, nobody: 0.53 }, 0.67),
      ),
    ).toEqual({ quiet: false, reason: "worth reading now" });
  });

  it("brings back a plausible request", () => {
    expect(
      judgeAnswers(
        withProbabilities(0.23, { user: 0.31, agent: 0.08, running: 0.05, nobody: 0.56 }, 0.32),
      ).reason,
    ).toBe("asks you");
  });
});
