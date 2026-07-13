import { describe, expect, it } from "vitest";
import { packChatHistory, packToolOutput, truncateText } from "./ai-context-pack";

describe("truncateText", () => {
  it("leaves short strings alone", () => {
    expect(truncateText("hi", 10)).toBe("hi");
  });
  it("truncates long strings", () => {
    const s = "a".repeat(200);
    const out = truncateText(s, 50);
    expect(out.length).toBeLessThan(s.length);
    expect(out).toContain("truncated");
  });
});

describe("packToolOutput", () => {
  it("passes small objects through", () => {
    expect(packToolOutput({ ok: true })).toEqual({ ok: true });
  });
  it("truncates large content fields", () => {
    const out = packToolOutput({ content: "x".repeat(50_000) }, 1000) as {
      content: string;
    };
    expect(out.content.length).toBeLessThan(50_000);
  });
});

describe("packChatHistory", () => {
  it("keeps only recent turns", () => {
    const msgs = Array.from({ length: 40 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `m${i}`,
    }));
    const packed = packChatHistory(msgs, { maxTurns: 4 });
    expect(packed.length).toBe(4);
    expect(packed[0].content).toBe("m36");
  });
});
