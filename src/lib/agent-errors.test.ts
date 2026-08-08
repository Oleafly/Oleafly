import { describe, expect, it } from "vitest";
import { agentErrorKind } from "./agent-backend";

describe("agent error kind crossing IPC", () => {
  it("reads the tag from a raw rejected string", () => {
    expect(agentErrorKind("[auth] 401 unauthorized")).toBe("auth");
  });

  it("reads the tag when the string was wrapped in an Error", () => {
    expect(agentErrorKind(new Error("[auth] 401 unauthorized"))).toBe("auth");
  });

  it("does not match a tag that only appears mid message", () => {
    expect(agentErrorKind("provider said [auth] is required")).toBe("");
  });

  it("distinguishes other kinds from auth", () => {
    expect(agentErrorKind("[transport] connection refused")).toBe("transport");
    expect(agentErrorKind("[not_configured] no key")).toBe("not_configured");
  });

  it("returns nothing for an untagged failure", () => {
    expect(agentErrorKind("something broke")).toBe("");
  });
});
