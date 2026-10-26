import { describe, expect, it } from "vitest";
import { reorderRequestFor } from "./usePinnedReorder";

const order = ["a", "b", "c", "d"];

describe("reorderRequestFor", () => {
  it("moves a row down between two others", () => {
    expect(
      reorderRequestFor(order, { threadId: "a", insertBefore: 3 }),
    ).toEqual({
      nextOrder: ["b", "c", "a", "d"],
      request: { threadId: "a", previousThreadId: "c", nextThreadId: "d" },
    });
  });

  it("moves a row to the top", () => {
    expect(
      reorderRequestFor(order, { threadId: "c", insertBefore: 0 }),
    ).toEqual({
      nextOrder: ["c", "a", "b", "d"],
      request: { threadId: "c", previousThreadId: null, nextThreadId: "a" },
    });
  });

  it("moves a row to the bottom", () => {
    expect(
      reorderRequestFor(order, { threadId: "b", insertBefore: 4 }),
    ).toEqual({
      nextOrder: ["a", "c", "d", "b"],
      request: { threadId: "b", previousThreadId: "d", nextThreadId: null },
    });
  });

  it("ignores a drop back where the row started", () => {
    expect(
      reorderRequestFor(order, { threadId: "b", insertBefore: 1 }),
    ).toBeNull();
    expect(
      reorderRequestFor(order, { threadId: "b", insertBefore: 2 }),
    ).toBeNull();
  });
});
