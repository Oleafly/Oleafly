import { describe, expect, it } from "vitest";
import { windowsBuildNumber, windowsPtyOption } from "./terminal-platform";

describe("terminal platform options", () => {
  it("reads the Windows build", () => {
    expect(windowsBuildNumber("10.0.22631")).toBe(22631);
    expect(windowsBuildNumber("10.0.19045.3803")).toBe(19045);
    expect(windowsBuildNumber("garbage")).toBeUndefined();
    expect(windowsBuildNumber("")).toBeUndefined();
    expect(windowsPtyOption("windows", () => "10.0.22631")).toEqual({ backend: "conpty", buildNumber: 22631 });
    expect(
      windowsPtyOption("windows", () => {
        throw new Error("no plugin");
      }),
    ).toEqual({ backend: "conpty" });
    expect(windowsPtyOption("linux", () => "6.8")).toBeUndefined();
    expect(windowsPtyOption("mac", () => "15.1")).toBeUndefined();
  });
});
