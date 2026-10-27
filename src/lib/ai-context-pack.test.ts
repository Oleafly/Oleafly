import { describe, expect, it } from "vitest";
import {
  TOOL_RESULT_MAX_CHARS,
  packChatHistory,
  packChatHistoryInfo,
  packToolOutput,
  truncateMiddle,
  truncateText,
} from "./ai-context-pack";

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

describe("truncateMiddle", () => {
  it("leaves short strings alone", () => {
    expect(truncateMiddle("hi", 10)).toBe("hi");
  });

  it("keeps the start and the end of a long string", () => {
    const s = `START${"a".repeat(1_000)}END`;
    const out = truncateMiddle(s, 200);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.startsWith("START")).toBe(true);
    expect(out.endsWith("END")).toBe(true);
    expect(out).toContain("truncated");
  });
});

describe("packToolOutput", () => {
  const failedBuild = (output: string) => ({
    exec: true,
    command: "cargo build",
    exit_code: 101,
    status: "Failed with exit code 101",
    timed_out: false,
    truncated: false,
    output,
  });

  it("keeps the exit status and the end of a long command output", () => {
    const output = `${"   Compiling crate v1.0.0\n".repeat(2_000)}error: could not compile \`app\`\n`;
    const packed = packToolOutput(failedBuild(output)) as Record<string, unknown>;

    expect(JSON.stringify(packed).length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS);
    expect(packed).toMatchObject({
      exec: true,
      command: "cargo build",
      exit_code: 101,
      status: "Failed with exit code 101",
      timed_out: false,
      truncated: true,
    });
    expect(packed.output).toMatch(/^ {3}Compiling crate/);
    expect(packed.output).toMatch(/error: could not compile `app`\n$/);
  });

  it("still fits when JSON escaping makes the output longer than its text", () => {
    // Colour codes and Windows paths escape to several JSON characters each.
    const line = '\u001b[1m\u001b[31merror\u001b[0m\u001b[2m: "C:\\Users\\me\\main.tex"\u001b[0m\n';
    const packed = packToolOutput(failedBuild(`${line.repeat(1_500)}FAILED at the end\n`)) as Record<
      string,
      unknown
    >;

    expect(JSON.stringify(packed).length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS);
    expect(packed).toMatchObject({ exit_code: 101, timed_out: false, truncated: true });
    expect(packed.output).toMatch(/FAILED at the end\n$/);
  });

  it("falls back to a preview when the oversized part is not text", () => {
    const packed = packToolOutput({ ok: true, items: Array.from({ length: 5_000 }, (_, i) => i) });
    expect(packed).toMatchObject({ truncated: true });
    expect((packed as { preview: string }).preview.startsWith('{"ok":true')).toBe(true);
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

