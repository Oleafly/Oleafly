import { describe, it, expect, beforeEach } from "vitest";
import { useInlineEditStore } from "./inlineEdit";

const s = () => useInlineEditStore.getState();
beforeEach(() => s().reset());

describe("inline edit store", () => {
  it("opens a prompting session for a range", () => {
    s().open({ from: 5, to: 12, original: "old txt" });
    expect(s().session).toMatchObject({
      phase: "prompting",
      from: 5,
      to: 12,
      original: "old txt",
      proposed: "",
    });
  });

  it("walks prompting -> streaming -> reviewing", () => {
    s().open({ from: 0, to: 3, original: "abc" });
    s().setInstruction("improve");
    expect(s().session?.instruction).toBe("improve");
    s().startStreaming();
    expect(s().session?.phase).toBe("streaming");
    s().appendProposed("AB");
    s().appendProposed("ABC!");
    expect(s().session?.proposed).toBe("ABC!");
    s().finishReviewing();
    expect(s().session?.phase).toBe("reviewing");
  });

  it("fail() moves to error with a message; reset() clears", () => {
    s().open({ from: 0, to: 1, original: "x" });
    s().fail("network");
    expect(s().session).toMatchObject({ phase: "error", error: "network" });
    s().reset();
    expect(s().session).toBeNull();
  });

  it("mutations are no-ops when there is no open session", () => {
    s().appendProposed("nope");
    s().finishReviewing();
    expect(s().session).toBeNull();
  });
});
