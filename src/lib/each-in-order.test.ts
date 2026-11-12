import { describe, expect, it } from "vitest";
import { eachInOrder } from "./each-in-order";

describe("eachInOrder", () => {
  it("starts each task only after the one before it settles", async () => {
    const events: string[] = [];
    await eachInOrder([3, 1, 2], async (delay) => {
      events.push(`start ${delay}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      events.push(`end ${delay}`);
    });
    expect(events).toEqual(["start 3", "end 3", "start 1", "end 1", "start 2", "end 2"]);
  });

  it("stops at the first failure and rejects with it", async () => {
    const seen: number[] = [];
    const failure = new Error("second");
    await expect(
      eachInOrder([1, 2, 3], async (item) => {
        seen.push(item);
        if (item === 2) throw failure;
      }),
    ).rejects.toBe(failure);
    expect(seen).toEqual([1, 2]);
  });

  it("resolves without calling the task for an empty list", async () => {
    const seen: number[] = [];
    await eachInOrder([], async (item: number) => {
      seen.push(item);
    });
    expect(seen).toEqual([]);
  });
});
