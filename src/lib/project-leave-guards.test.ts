import { describe, expect, it, vi } from "vitest";

const logError = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/log", () => ({ logError }));

import { projectLeaveAllowed, registerProjectLeaveGuard, type ProjectLeave } from "./project-leave-guards";

const leave: ProjectLeave = { projectId: "p1", reason: "switch", targetProjectId: "p2" };

describe("project leave guards", () => {
  it("allows leaving when no guard is registered", async () => {
    expect(await projectLeaveAllowed(leave)).toBe(true);
  });

  it("runs guards in order, stops at the first no, and ignores a guard that throws", async () => {
    const calls: string[] = [];
    const stops = [
      registerProjectLeaveGuard(async () => {
        calls.push("broken");
        throw new Error("broken guard");
      }),
      registerProjectLeaveGuard(async (seen) => {
        calls.push(`first:${seen.reason}:${seen.targetProjectId}`);
        return true;
      }),
      registerProjectLeaveGuard(async () => {
        calls.push("second");
        return false;
      }),
      registerProjectLeaveGuard(async () => {
        calls.push("third");
        return true;
      }),
    ];

    expect(await projectLeaveAllowed(leave)).toBe(false);
    expect(calls).toEqual(["broken", "first:switch:p2", "second"]);
    expect(logError).toHaveBeenCalledWith("project leave guard", expect.any(Error));

    stops[2]();
    calls.length = 0;
    expect(await projectLeaveAllowed(leave)).toBe(true);
    expect(calls).toEqual(["broken", "first:switch:p2", "third"]);
    for (const stop of stops) stop();
    expect(await projectLeaveAllowed(leave)).toBe(true);
  });
});
