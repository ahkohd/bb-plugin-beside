import { describe, expect, it } from "vitest";
import { reorderRequestFor } from "./usePinnedReorder";

const order = ["a", "b", "c", "d"];

describe("reorderRequestFor", () => {
  it("moves a row down onto another row's place", () => {
    expect(reorderRequestFor(order, "a", "c")).toEqual({
      nextOrder: ["b", "c", "a", "d"],
      request: { threadId: "a", previousThreadId: "c", nextThreadId: "d" },
    });
  });

  it("moves a row to the top", () => {
    expect(reorderRequestFor(order, "c", "a")).toEqual({
      nextOrder: ["c", "a", "b", "d"],
      request: { threadId: "c", previousThreadId: null, nextThreadId: "a" },
    });
  });

  it("moves a row to the bottom", () => {
    expect(reorderRequestFor(order, "b", "d")).toEqual({
      nextOrder: ["a", "c", "d", "b"],
      request: { threadId: "b", previousThreadId: "d", nextThreadId: null },
    });
  });

  it("ignores a drop back on the row itself", () => {
    expect(reorderRequestFor(order, "b", "b")).toBeNull();
  });
});
