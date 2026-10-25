import { describe, expect, it } from "vitest";
import { packChatHistory, truncateText, packChatHistoryInfo } from "./ai-context-pack";

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


describe("packChatHistory", () => {
  it("keeps only recent turns", () => {
    const msgs = Array.from({ length: 40 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `m${i}`,
    }));
    const packed = packChatHistory(msgs, { maxTurns: 4 });
    expect(packed).toHaveLength(4);
    expect(packed[0].content).toBe("m36");
  });

  it("reports the turns it dropped", () => {
    const msgs = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `m${i}`,
    }));
    const packed = packChatHistoryInfo(msgs);
    expect(packed.droppedTurns).toBe(6);
    expect(packed.messages).toHaveLength(24);
    expect(packChatHistoryInfo(msgs.slice(0, 4)).droppedTurns).toBe(0);
  });
});

