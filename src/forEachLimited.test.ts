import { describe, expect, it } from "vitest";
import { forEachLimited } from "./forEachLimited";

describe("forEachLimited", () => {
  it("keeps going past failures and reports both sides", async () => {
    const result = await forEachLimited([1, 2, 3, 4], async (n) => {
      if (n % 2 === 0) throw new Error("even");
    });
    expect(result.succeeded.sort()).toEqual([1, 3]);
    expect(result.failed.sort()).toEqual([2, 4]);
  });

  it("never runs more than six at once", async () => {
    let running = 0;
    let peak = 0;
    await forEachLimited(
      Array.from({ length: 20 }, (_, index) => index),
      async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 1));
        running -= 1;
      },
    );
    expect(peak).toBe(6);
  });
});
